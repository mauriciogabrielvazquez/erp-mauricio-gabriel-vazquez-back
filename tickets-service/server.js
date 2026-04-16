require('dotenv').config();
const Fastify = require('fastify');
const { createClient } = require('@supabase/supabase-js');

const fastify = Fastify({ logger: true });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const formatResponse = (statusCode, intOpCode, data) => {
    return { statusCode, intOpCode, data };
};


fastify.setErrorHandler(function (error, request, reply) {
    if (error.validation) {
        return reply.code(400).send(formatResponse(400, 'SxTK400', {
            message: 'Error de validación de datos',
            detalles: error.validation
        }));
    }
    fastify.log.error(error);
    return reply.code(error.statusCode || 500).send(formatResponse(error.statusCode || 500, 'SxTK500', { message: 'Error interno del servidor' }));
});

// ==========================================
// 🔥 JSON SCHEMAS PARA TICKETS
// ==========================================
const createTicketSchema = {
    body: {
        type: 'object',
        required: ['titulo', 'grupo_id'],
        properties: {
            titulo: { type: 'string', minLength: 1 },
            descripcion: { type: 'string' },
            grupo_id: { type: 'string', format: 'uuid' }, // Fastify verificará que sea un UUID real
            estado: { type: 'string' },
            prioridad: { type: 'string' },
            asignado_id: { type: ['string', 'null'] },
            fecha_final: { type: ['string', 'null'] },
            historial: { type: 'array' }
        }
    }
};

const updateTicketSchema = {
    body: {
        type: 'object',
        properties: {
            titulo: { type: 'string', minLength: 1 },
            descripcion: { type: 'string' },
            estado: { type: 'string' },
            prioridad: { type: 'string' },
            asignado_id: { type: ['string', 'null'] },
            fecha_final: { type: ['string', 'null'] },
            comentarios: { type: 'array' },
            historial: { type: 'array' }
        },
        minProperties: 1 // Exige que al menos se envíe un campo para actualizar
    }
};

// ==========================================
// RUTAS
// ==========================================

// 1. OBTENER TICKETS POR GRUPO
fastify.get('/tickets/group/:groupId', async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const { groupId } = request.params;
        
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                *,
                autor:usuarios!autor_id(nombre_completo),
                asignado:usuarios!asignado_id(id, nombre_completo)
            `)
            .eq('grupo_id', groupId)
            .order('creado_en', { ascending: false });

        if (error) throw error;

        return reply.code(200).send(formatResponse(200, 'SxTK200', data));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno del servidor' }));
    }
});

// 2. CREAR UN TICKET (Con validación de Schema)
fastify.post('/tickets', { schema: createTicketSchema }, async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const { titulo, descripcion, grupo_id, estado, prioridad, asignado_id, fecha_final, historial } = request.body;

        const nuevoTicket = {
            titulo,
            descripcion: descripcion || '',
            grupo_id,
            estado: estado || 'To-Do',
            prioridad: prioridad || 'Media',
            autor_id: userId,
            asignado_id: asignado_id || null, 
            fecha_final: fecha_final || null,
            comentarios: [], 
            historial: historial || []
        };

        const { data, error } = await supabase
            .from('tickets')
            .insert([nuevoTicket])
            .select(); 

        if (error) throw error;

        return reply.code(201).send(formatResponse(201, 'SxTK201', data[0]));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno' }));
    }
});

// 3. ACTUALIZAR UN TICKET (Con validación de Schema)
fastify.patch('/tickets/:id', { schema: updateTicketSchema }, async (request, reply) => {
    try {
        const userId = request.headers['x-user-id'];
        if (!userId) return reply.code(403).send(formatResponse(403, 'SxTK403', { message: 'Usuario no identificado' }));

        const ticketId = request.params.id;
        const updates = request.body; 

        const { data: updatedTicket, error: updateError } = await supabase
            .from('tickets')
            .update(updates)
            .eq('id', ticketId)
            .select();

        if (updateError) throw updateError;
        
        if (!updatedTicket || updatedTicket.length === 0) {
            return reply.code(404).send(formatResponse(404, 'SxTK404', { message: 'Ticket no encontrado' }));
        }

        return reply.code(200).send(formatResponse(200, 'SxTK200', updatedTicket[0]));

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send(formatResponse(500, 'SxTK500', { message: 'Error interno' }));
    }
});

// 4. ELIMINAR UN TICKET
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

fastify.get('/tickets/user/:userId', async (request, reply) => {
    try {
        const userId = request.params.userId;
        
        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('asignado_id', userId)
            .order('creado_en', { ascending: false }); // Los más recientes primero

        if (error) throw error;

        return reply.code(200).send({ statusCode: 200, intOpCode: 'SxTK200', data: data });

    } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ statusCode: 500, intOpCode: 'SxTK500', data: { message: 'Error interno' } });
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