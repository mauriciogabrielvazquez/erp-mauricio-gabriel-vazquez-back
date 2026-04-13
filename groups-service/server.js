require('dotenv').config();
const Fastify = require('fastify');
const { createClient } = require('@supabase/supabase-js');

const fastify = Fastify({ logger: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const formatResponse = (statusCode, intOpCode, data) => {
    return { statusCode, intOpCode, data };
};

fastify.get('/groups', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxGR403', { message: 'Usuario no identificado' }));

        const { data, error } = await supabase
            .from('grupo_miembros')
            .select(`
                fecha_unido,
                grupos ( id, nombre, descripcion, creador_id, creado_en )
            `)
            .eq('usuario_id', userId);

        if (error) throw error;

        const gruposFormateados = data.map(item => item.grupos);

        return reply.code(200).send(formatResponse(200, 'SxGR200', gruposFormateados));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxGR500', { message: 'Error interno' }));
    }
});

fastify.post('/groups', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxGR403', { message: 'Usuario no identificado' }));

        const { nombre, descripcion } = request.body;
        if (!nombre) return reply.code(400).send(formatResponse(400, 'SxGR400', { message: 'El nombre es obligatorio' }));

        const { data: nuevoGrupo, error: grupoError } = await supabase
            .from('grupos')
            .insert([{ nombre, descripcion, creador_id: userId }])
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

fastify.post('/groups/:id/permissions', async (request, reply) => {
    try {
        const grupoId = request.params.id;
        const { usuario_id, permiso_id } = request.body;

        if (!usuario_id || !permiso_id) {
            return reply.code(400).send(formatResponse(400, 'SxGR400', { message: 'Faltan datos' }));
        }

        const { data, error } = await supabase
            .from('grupo_usuario_permisos')
            .insert([{ grupo_id: grupoId, usuario_id: usuario_id, permiso_id: permiso_id }])
            .select();

        if (error) {
            if (error.code === '23505') {
                return reply.code(400).send(formatResponse(400, 'SxGR400', { message: 'El usuario ya tiene este permiso en este grupo' }));
            }
            throw error;
        }

        return reply.code(201).send(formatResponse(201, 'SxGR201', { message: 'Permiso asignado correctamente', data }));

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