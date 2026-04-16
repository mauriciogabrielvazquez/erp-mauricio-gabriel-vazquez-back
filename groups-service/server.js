require('dotenv').config();
const Fastify = require('fastify');
const { createClient } = require('@supabase/supabase-js');

// Quitamos el ignoreTrailingSlash para evitar la advertencia amarilla
const fastify = Fastify({ logger: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const formatResponse = (statusCode, intOpCode, data) => ({ statusCode, intOpCode, data });

// ==========================================
// MANEJADOR GLOBAL
// ==========================================
fastify.setErrorHandler(function (error, request, reply) {
    if (error.validation) {
        return reply.code(400).send(formatResponse(400, 'SxGR400', {
            message: 'Error de validación de datos',
            detalles: error.validation
        }));
    }
    fastify.log.error(error);
    return reply.code(error.statusCode || 500).send(formatResponse(error.statusCode || 500, 'SxGR500', { message: 'Error interno del servidor' }));
});

// ==========================================
// JSON SCHEMAS
// ==========================================
const createGroupSchema = {
    body: {
        type: 'object',
        required: ['nombre'],
        properties: {
            nombre: { type: 'string', minLength: 1 },
            descripcion: { type: 'string' },
            categoria: { type: 'string' },
            nivel: { type: 'string' },
            profesor: { type: 'string' },
            imagen_url: { type: 'string' }
        }
    }
};

const updateGroupSchema = {
    body: {
        type: 'object',
        properties: {
            nombre: { type: 'string', minLength: 1 },
            descripcion: { type: 'string' },
            categoria: { type: 'string' },
            nivel: { type: 'string' },
            profesor: { type: 'string' },
            imagen_url: { type: 'string' }
        },
        minProperties: 1 
    }
};

const assignMemberSchema = {
    body: {
        type: 'object',
        required: ['usuario_id'],
        properties: {
            usuario_id: { type: 'string', format: 'uuid' }
        }
    }
};

// ESQUEMA ACTUALIZADO: Ahora acepta un arreglo de permisos
const assignPermissionSchema = {
    body: {
        type: 'object',
        required: ['usuario_id', 'permisos'],
        properties: {
            usuario_id: { type: 'string', format: 'uuid' },
            permisos: { type: 'array', items: { type: 'string' } }
        }
    }
};

// ==========================================
// RUTAS
// ==========================================

fastify.get('/groups', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxGR403', { message: 'Usuario no identificado' }));

        const { data: memberData, error: memberError } = await supabase
            .from('grupo_miembros')
            .select('grupo_id')
            .eq('usuario_id', userId);

        if (memberError) throw memberError;

        if (!memberData || memberData.length === 0) {
            return reply.code(200).send(formatResponse(200, 'SxGR200', []));
        }

        const groupIds = memberData.map(m => m.grupo_id);
        const { data: groupData, error: groupError } = await supabase
            .from('grupos')
            .select(`
                id, nombre, descripcion, categoria, nivel, profesor, imagen_url, creador_id, creado_en,
                grupo_miembros (count)
            `)
            .in('id', groupIds);

        if (groupError) throw groupError;
        const { data: ticketData, error: ticketError } = await supabase
            .from('tickets')
            .select('grupo_id')
            .in('grupo_id', groupIds);
            
        if (ticketError) {
             fastify.log.warn("No se pudieron cargar los tickets: ", ticketError);
   
        }

        const gruposFormateados = groupData.map(g => {
            const memberCount = g.grupo_miembros?.[0]?.count || 0;
            const ticketCount = ticketData ? ticketData.filter(t => t.grupo_id === g.id).length : 0;
            
            const { grupo_miembros, ...cleanGroup } = g; 

            return {
                ...cleanGroup,
                miembros_count: memberCount,
                tickets_count: ticketCount
            };
        });

        return reply.code(200).send(formatResponse(200, 'SxGR200', gruposFormateados));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.post('/groups', { schema: createGroupSchema }, async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxGR403', { message: 'Usuario no identificado' }));

        const { nombre, descripcion, categoria, nivel, profesor, imagen_url } = request.body;
        
        const { data: nuevoGrupo, error: grupoError } = await supabase
            .from('grupos')
            .insert([{ nombre, descripcion, categoria, nivel, profesor, imagen_url, creador_id: userId }])
            .select()
            .single();

        if (grupoError) throw grupoError;

        const { error: miembroError } = await supabase
            .from('grupo_miembros')
            .insert([{ grupo_id: nuevoGrupo.id, usuario_id: userId }]);

        if (miembroError) throw miembroError;

        return reply.code(201).send(formatResponse(201, 'SxGR201', nuevoGrupo));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.patch('/groups/:id', { schema: updateGroupSchema }, async (request, reply) => {
    try {
        const grupoId = request.params.id;
        const updates = request.body;

        const { data, error } = await supabase
            .from('grupos')
            .update(updates)
            .eq('id', grupoId)
            .select();

        if (error) throw error;
        if (data.length === 0) return reply.code(404).send(formatResponse(404, 'SxGR404', { message: 'Grupo no encontrado' }));

        return reply.code(200).send(formatResponse(200, 'SxGR200', data[0]));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.delete('/groups/:id', async (request, reply) => {
    try {
        const grupoId = request.params.id;

        const { error } = await supabase
            .from('grupos')
            .delete()
            .eq('id', grupoId);

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxGR200', { message: 'Grupo eliminado correctamente' }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

// NUEVA RUTA: Para LEER los permisos de un usuario en un grupo
fastify.get('/groups/:id/permissions/:userId', async (request, reply) => {
    try {
        const { id: grupoId, userId } = request.params;
        
        const { data, error } = await supabase
            .from('grupo_usuario_permisos')
            .select('permiso_id')
            .match({ grupo_id: grupoId, usuario_id: userId });

        if (error) throw error;

        // Extraemos solo el texto de los permisos para enviarlo como un arreglo
        const permisos = data.map(p => p.permiso_id);
        return reply.code(200).send(formatResponse(200, 'SxGR200', permisos));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

// RUTA ACTUALIZADA: Para GUARDAR (Sobrescribir) los permisos
fastify.post('/groups/:id/permissions', { schema: assignPermissionSchema }, async (request, reply) => {
    try {
        const grupoId = request.params.id;
        const { usuario_id, permisos } = request.body;

        // 1. Borramos todos los permisos anteriores de este usuario en este grupo
        await supabase.from('grupo_usuario_permisos')
            .delete()
            .match({ grupo_id: grupoId, usuario_id: usuario_id });

        // 2. Si hay permisos nuevos, los insertamos
        if (permisos && permisos.length > 0) {
            const nuevosPermisos = permisos.map(p => ({
                grupo_id: grupoId,
                usuario_id: usuario_id,
                permiso_id: p
            }));
            const { error: insertError } = await supabase.from('grupo_usuario_permisos').insert(nuevosPermisos);
            if (insertError) throw insertError;
        }

        return reply.code(200).send(formatResponse(200, 'SxGR200', { message: 'Permisos de grupo actualizados' }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.get('/groups/:id/members', async (request, reply) => {
    try {
        const grupoId = request.params.id;
        
        const { data, error } = await supabase
            .from('grupo_miembros')
            .select(`
                usuarios ( id, username, email, nombre_completo )
            `)
            .eq('grupo_id', grupoId);

        if (error) throw error;

        const miembros = data.map(item => item.usuarios).filter(u => u !== null);
        return reply.code(200).send(formatResponse(200, 'SxGR200', miembros));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.post('/groups/:id/members', { schema: assignMemberSchema }, async (request, reply) => {
    try {
        const grupoId = request.params.id;
        const { usuario_id } = request.body;

        const { data, error } = await supabase
            .from('grupo_miembros')
            .insert([{ grupo_id: grupoId, usuario_id }])
            .select();

        if (error) {
            if (error.code === '23505') {
                return reply.code(400).send(formatResponse(400, 'SxGR400', { message: 'El usuario ya pertenece a este grupo' }));
            }
            throw error;
        }

        return reply.code(201).send(formatResponse(201, 'SxGR201', { message: 'Alumno añadido' }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.delete('/groups/:id/members/:userId', async (request, reply) => {
    try {
        const { id: grupoId, userId } = request.params;

        const { error } = await supabase
            .from('grupo_miembros')
            .delete()
            .match({ grupo_id: grupoId, usuario_id: userId });

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxGR200', { message: 'Alumno removido del grupo' }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3003 });
        console.log(`Microservicio de Grupos corriendo en el puerto ${process.env.PORT || 3003}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();