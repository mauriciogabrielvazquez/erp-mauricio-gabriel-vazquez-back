require('dotenv').config();
const Fastify = require('fastify');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const fastify = Fastify({ logger: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const formatResponse = (statusCode, intOpCode, data) => {
    return { statusCode, intOpCode, data };
};

fastify.setErrorHandler(function (error, request, reply) {
    if (error.validation) {
        return reply.code(400).send(formatResponse(400, 'SxUS400', {
            message: 'Error de validación de datos',
            detalles: error.validation
        }));
    }
    fastify.log.error(error);
    return reply.code(error.statusCode || 500).send(formatResponse(error.statusCode || 500, 'SxUS500', { message: 'Error interno del servidor' }));
});

const registerSchema = {
    body: {
        type: 'object',
        required: ['nombre_completo', 'username', 'email', 'password'],
        properties: {
            nombre_completo: { type: 'string', minLength: 3 },
            username: { type: 'string', minLength: 3 },
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 6 },
            direccion: { type: 'string' }, 
            telefono: { type: 'string' }   
        }
    }
};

const loginSchema = {
    body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' }
        }
    }
};

const updateUserSchema = {
    body: {
        type: 'object',
        properties: {
            nombre_completo: { type: 'string', minLength: 3 },
            username: { type: 'string', minLength: 3 },
            email: { type: 'string', format: 'email' },
            direccion: { type: 'string' },
            telefono: { type: 'string' }
        },
        anyOf: [ // Exige que al menos se envíe UN campo para actualizar
            { required: ['nombre_completo'] },
            { required: ['username'] },
            { required: ['email'] },
            { required: ['direccion'] },
            { required: ['telefono'] }
        ]
    }
};

const permissionsSchema = {
    body: {
        type: 'object',
        required: ['permisos'],
        properties: {
            permisos: {
                type: 'array',
                items: { type: 'string' }
            }
        }
    }
};

// ==========================================
// RUTAS (Ahora conectadas a sus Schemas)
// ==========================================

fastify.post('/auth/register', { schema: registerSchema }, async (request, reply) => {
    try {
        const { nombre_completo, username, email, password, direccion, telefono } = request.body;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { data, error } = await supabase
            .from('usuarios')
            .insert([{ 
                nombre_completo, 
                username, 
                email, 
                password: hashedPassword,
                direccion, 
                telefono   
            }])
            .select();

        if (error) throw error;

        return reply.code(201).send(formatResponse(201, 'SxUS201', { message: 'Usuario registrado exitosamente', user: data[0] }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno del servidor' }));
    }
});

fastify.post('/auth/login', { schema: loginSchema }, async (request, reply) => {
    try {
        const { email, password } = request.body;

        const { data: user, error } = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return reply.code(401).send(formatResponse(401, 'SxUS401', { message: 'Credenciales inválidas' }));
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return reply.code(401).send(formatResponse(401, 'SxUS401', { message: 'Credenciales inválidas' }));
        }

        const { data: permisosData, error: permError } = await supabase
            .from('usuario_permisos_globales')
            .select('permiso')
            .eq('usuario_id', user.id);

        let listaPermisos = [];
        if (!permError && permisosData) {
            listaPermisos = permisosData.map(p => p.permiso);
        }

        const { data: permisosGrupoData, error: permGrupoError } = await supabase
            .from('grupo_usuario_permisos')
            .select('grupo_id, permiso_id')
            .eq('usuario_id', user.id);

        let permisosPorGrupo = {};
        if (!permGrupoError && permisosGrupoData) {
            permisosGrupoData.forEach(p => {
                if (!permisosPorGrupo[p.grupo_id]) {
                    permisosPorGrupo[p.grupo_id] = [];
                }
                permisosPorGrupo[p.grupo_id].push(p.permiso_id);
            });
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                username: user.username,
                email: user.email,
                permisos: listaPermisos,
                permisosPorGrupo: permisosPorGrupo
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        await supabase.from('usuarios').update({ last_login: new Date() }).eq('id', user.id);

        return reply.code(200).send(formatResponse(200, 'SxUS200', { 
            message: 'Login exitoso', 
            token: token,
            permisos: listaPermisos 
        }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno del servidor' }));
    }
});

fastify.get('/users', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxUS403', { message: 'Usuario no identificado' }));

        const { data, error } = await supabase
            .from('usuarios')
            .select('id, nombre_completo, username, email, direccion, telefono, fecha_inicio, last_login, creado_en');

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxUS200', data));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno del servidor' }));
    }
});

fastify.patch('/users/:id', { schema: updateUserSchema }, async (request, reply) => {
    try {
        const userIdHeader = request.headers['x-user-id'];
        if (!userIdHeader) return reply.code(403).send(formatResponse(403, 'SxUS403', { message: 'Usuario no identificado' }));

        const idUsuarioAEditar = request.params.id;
        const { nombre_completo, username, email, direccion, telefono } = request.body;

        const { data, error } = await supabase
            .from('usuarios')
            .update({ nombre_completo, username, email, direccion, telefono })
            .eq('id', idUsuarioAEditar)
            .select('id, nombre_completo, username, email, direccion, telefono');

        if (error) throw error;

        if (data.length === 0) {
            return reply.code(404).send(formatResponse(404, 'SxUS404', { message: 'Usuario no encontrado' }));
        }

        return reply.code(200).send(formatResponse(200, 'SxUS200', data[0]));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno del servidor' }));
    }
});

fastify.get('/users/:id/permissions', async (request, reply) => {
    try {
        const targetUserId = request.params.id;
        const { data, error } = await supabase
            .from('usuario_permisos_globales')
            .select('permiso')
            .eq('usuario_id', targetUserId);

        if (error) throw error;

        const permisos = data.map(p => p.permiso);
        return reply.code(200).send(formatResponse(200, 'SxUS200', permisos));
    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno' }));
    }
});

fastify.post('/users/:id/permissions', { schema: permissionsSchema }, async (request, reply) => {
    try {
        const targetUserId = request.params.id;
        const { permisos } = request.body;

        await supabase.from('usuario_permisos_globales').delete().eq('usuario_id', targetUserId);

        if (permisos && permisos.length > 0) {
            const nuevosPermisos = permisos.map(p => ({
                usuario_id: targetUserId,
                permiso: p
            }));
            const { error: insertError } = await supabase.from('usuario_permisos_globales').insert(nuevosPermisos);
            if (insertError) throw insertError;
        }

        return reply.code(200).send(formatResponse(200, 'SxUS200', { message: 'Permisos actualizados' }));
    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno' }));
    }
});

const start = async () => {
    try {
        await fastify.listen({ 
            port: process.env.PORT || 3000,
            host: '0.0.0.0' 
        });
        console.log(`Servidor iniciado en puerto ${process.env.PORT || 3000}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();