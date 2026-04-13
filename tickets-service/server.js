require('dotenv').config();
const Fastify = require('fastify');
const { createClient } = require('@supabase/supabase-js');

const fastify = Fastify({ logger: true });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const formatResponse = (statusCode, intOpCode, data) => {
    return { statusCode, intOpCode, data };
};

fastify.get('/tickets', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const { data, error } = await supabase
            .from('tickets')
            .select('*');

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxTK200', data));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno del servidor' }));
    }
});

fastify.post('/tickets', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const { titulo, descripcion, grupo_id, prioridad } = request.body;

        if (!titulo || !grupo_id) {
            return reply.code(400).send(formatResponse(400, 'SxTK400', { message: 'El título y grupo_id son obligatorios' }));
        }

        const { data, error } = await supabase
            .from('tickets')
            .insert([
                {
                    titulo,
                    descripcion,
                    grupo_id,
                    prioridad: prioridad || 'Media',
                    autor_id: userId,
                    asignado_id: userId 
                }
            ])
            .select(); 

        if (error) throw error;

        return reply.code(201).send(formatResponse(201, 'SxTK201', data));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno' }));
    }
});

fastify.patch('/tickets/:id/status', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const ticketId = request.params.id;
        const { estado } = request.body;

        if (!estado) {
            return reply.code(400).send(formatResponse(400, 'SxTK400', { message: 'El nuevo estado es obligatorio' }));
        }

        const { data: ticket, error: fetchError } = await supabase
            .from('tickets')
            .select('*')
            .eq('id', ticketId)
            .single();

        if (fetchError || !ticket) {
            return reply.code(404).send(formatResponse(404, 'SxTK404', { message: 'Ticket no encontrado' }));
        }

        if (ticket.asignado_id !== userId) {
            return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'No puedes mover un ticket que no te pertenece' }));
        }

        const { data: updatedTicket, error: updateError } = await supabase
            .from('tickets')
            .update({ estado: estado })
            .eq('id', ticketId)
            .select();

        if (updateError) throw updateError;

        return reply.code(200).send(formatResponse(200, 'SxTK200', updatedTicket));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno' }));
    }
});

fastify.delete('/tickets/:id', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const ticketId = request.params.id;

        const { error } = await supabase
            .from('tickets')
            .delete()
            .eq('id', ticketId);

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxTK200', { message: 'Ticket eliminado correctamente' }));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno' }));
    }
});

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3002 });
        console.log(`Microservicio de Tickets corriendo en el puerto ${process.env.PORT || 3002}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();