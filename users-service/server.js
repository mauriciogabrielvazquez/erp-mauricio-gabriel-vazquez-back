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

fastify.post('/auth/register', async (request, reply) => {
    try {
        const { nombre_completo, username, email, password } = request.body;

        if (!nombre_completo || !username || !email || !password) {
            return reply.code(400).send(formatResponse(400, 'SxUS400', { message: 'Faltan datos obligatorios' }));
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const { data, error } = await supabase
            .from('usuarios')
            .insert([{ nombre_completo, username, email, password: hashedPassword }])
            .select();

        if (error) throw error;

        return reply.code(201).send(formatResponse(201, 'SxUS201', { message: 'Usuario registrado exitosamente', user: data[0] }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxUS500', { message: 'Error interno del servidor' }));
    }
});

fastify.post('/auth/login', async (request, reply) => {
    try {
        const { email, password } = request.body;

        if (!email || !password) {
             return reply.code(400).send(formatResponse(400, 'SxUS400', { message: 'Email y contraseña son obligatorios' }));
        }

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

        const token = jwt.sign(
            { 
                userId: user.id, 
                username: user.username,
                email: user.email
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        await supabase.from('usuarios').update({ last_login: new Date() }).eq('id', user.id);

        return reply.code(200).send(formatResponse(200, 'SxUS200', { 
            message: 'Login exitoso', 
            token: token 
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

fastify.patch('/users/:id', async (request, reply) => {
    try {
        const userIdHeader = request.headers['x-user-id'];
        if (!userIdHeader) return reply.code(403).send(formatResponse(403, 'SxUS403', { message: 'Usuario no identificado' }));

        const idUsuarioAEditar = request.params.id;
        const { nombre_completo, username, email } = request.body;

        if (!nombre_completo && !username && !email) {
            return reply.code(400).send(formatResponse(400, 'SxUS400', { message: 'No se enviaron datos para actualizar' }));
        }

        const { data, error } = await supabase
            .from('usuarios')
            .update({ nombre_completo, username, email })
            .eq('id', idUsuarioAEditar)
            .select('id, nombre_completo, username, email');

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

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3001 });
        console.log(`Microservicio de Usuarios corriendo en el puerto ${process.env.PORT || 3001}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();