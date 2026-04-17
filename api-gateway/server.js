require('dotenv').config();
const Fastify = require('fastify');
const jwt = require('jsonwebtoken');
const rateLimit = require('@fastify/rate-limit');
const proxy = require('@fastify/http-proxy');
const cors = require('@fastify/cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('⚠️ ADVERTENCIA: Faltan credenciales de Supabase en el .env');
}
const supabase = createClient(supabaseUrl, supabaseKey);

const fastify = Fastify({ 
    ignoreTrailingSlash: true,
    logger: {
        level: 'info',
        transport: {
            targets: [
                {
                    target: 'pino-pretty',
                    options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' }
                },
                {
                    target: 'pino/file',
                    options: { destination: path.join(__dirname, 'api-audit.log'), append: true }
                }
            ]
        }
    } 
});

fastify.register(cors, {
    origin: true, 
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'PATCH'], 
    allowedHeaders: ['Content-Type', 'Authorization', 'x-group-id'] 
});

const formatResponse = (statusCode, intOpCode, data) => ({ statusCode, intOpCode, data });

fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: function (request, context) {
        return formatResponse(429, 'SxGW429', { message: 'Too many requests' });
    }
});

// ==========================================
// 📊 HOOK DE AUDITORÍA: Cronómetro Inicio
// ==========================================
fastify.addHook('onRequest', (request, reply, done) => {
    if (request.method !== 'OPTIONS') {
        request.startTime = process.hrtime();
    }
    done();
});

// ==========================================
// 🔒 HOOK DE SEGURIDAD: JWT y Permisos
// ==========================================
fastify.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') return; 
    if (request.url.startsWith('/auth/')) return;

    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(403).send(formatResponse(403, 'SxGW403', { message: 'Token no proporcionado o formato inválido' }));
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        request.headers['x-user-id'] = decoded.userId;

        // 🔥 VERIFICACIÓN DE PERMISOS (GLOBALES Y POR GRUPO)
        const userPermsGlobales = decoded.permisos || [];
        const userPermsPorGrupo = decoded.permisosPorGrupo || {}; 
        const currentGroupId = request.headers['x-group-id']; 

        let requiredPermission = null;

        if (request.url.startsWith('/tickets')) {
            if (request.method === 'POST') requiredPermission = 'add-ticket';
            if (request.method === 'PATCH' || request.method === 'PUT') requiredPermission = 'edit-ticket';
            if (request.method === 'DELETE') requiredPermission = 'delete-ticket';
        }
        
        if (request.url.startsWith('/groups')) {
            if (request.method === 'POST') requiredPermission = 'add-group';
            if (request.method === 'PATCH' || request.method === 'PUT') requiredPermission = 'edit-group';
            if (request.method === 'DELETE') requiredPermission = 'delete-group';
        }

        if (request.url.startsWith('/users') && request.method !== 'GET') {
            if (request.method === 'POST') requiredPermission = 'add-user';
            if (request.method === 'PATCH' || request.method === 'PUT') requiredPermission = 'edit-user';
            if (request.method === 'DELETE') requiredPermission = 'delete-user';
        }

        if (requiredPermission) {
            const tienePermisoGlobal = userPermsGlobales.includes(requiredPermission);
            let tienePermisoEnGrupo = false;
            
            if (currentGroupId && userPermsPorGrupo[currentGroupId]) {
                tienePermisoEnGrupo = userPermsPorGrupo[currentGroupId].includes(requiredPermission);
            }

            if (!tienePermisoGlobal && !tienePermisoEnGrupo) {
                fastify.log.warn(`Acceso denegado: Usuario ${decoded.userId} intentó ${requiredPermission} en grupo ${currentGroupId || 'N/A'}`);
                return reply.code(403).send(formatResponse(403, 'SxGW403', { message: 'No tienes los permisos necesarios para realizar esta acción en este grupo' }));
            }
        }

    } catch (error) {
        fastify.log.error('Error de token:', error.message);
        return reply.code(403).send(formatResponse(403, 'SxGW403', { message: 'Token expirado o inválido' }));
    }
});

// ==========================================
// 📊 HOOK DE AUDITORÍA: Registro en Base de Datos y Local
// ==========================================
fastify.addHook('onResponse', async (request, reply) => {
    if (request.method !== 'OPTIONS' && request.startTime) {
        const hrDuration = process.hrtime(request.startTime);
        const durationMs = (hrDuration[0] * 1000 + hrDuration[1] / 1e6).toFixed(2);
        const userId = request.headers['x-user-id'] || 'Visitante/Anónimo';
        
        // 1. Guardar en el archivo local (api-audit.log)
        const logMessage = `[${request.method}] ${request.url} - Status: ${reply.statusCode} - Usuario: ${userId} - Tiempo: ${durationMs}ms`;
        if (reply.statusCode >= 500) {
            fastify.log.error(`🔥 ERROR CRÍTICO: ${logMessage}`);
        } else if (reply.statusCode >= 400) {
            fastify.log.warn(`⚠️ ADVERTENCIA: ${logMessage}`);
        } else {
            fastify.log.info(`✅ ÉXITO: ${logMessage}`);
        }

        // 2. Guardar en Supabase para cumplir la rúbrica (Puntos Extra)
        if (supabaseUrl && supabaseKey) {
            try {
                await supabase.from('logs').insert([{
                    method: request.method,
                    url: request.url,
                    status: reply.statusCode,
                    user_id: userId === 'Visitante/Anónimo' ? null : userId,
                    response_time_ms: parseFloat(durationMs)
                }]);
            } catch (dbError) {
                fastify.log.error(`Error guardando log en BD: ${dbError.message}`);
            }
        }
    }
});

fastify.register(proxy, {
    upstream: 'https://erp-users.onrender.com', 
    prefix: '/auth',
    rewritePrefix: '/auth',
    replyOptions: { 
        rewriteRequestHeaders: (request, headers) => {
            const { host, ...forwardHeaders } = headers;
            return forwardHeaders;
        } 
    }
});

fastify.register(proxy, {
    upstream: 'https://erp-users.onrender.com', 
    prefix: '/users', 
    rewritePrefix: '/users',
    replyOptions: { 
        rewriteRequestHeaders: (request, headers) => {
            const { host, ...forwardHeaders } = headers;
            return forwardHeaders;
        } 
    }
});

fastify.register(proxy, {
    upstream: 'https://tickets-r9og.onrender.com', 
    prefix: '/tickets',
    rewritePrefix: '/tickets',
    replyOptions: { 
        rewriteRequestHeaders: (request, headers) => {
            const { host, ...forwardHeaders } = headers;
            return forwardHeaders;
        } 
    }
});

fastify.register(proxy, {
    upstream: 'https://groups-aycz.onrender.com', 
    prefix: '/groups',
    rewritePrefix: '/groups',
    replyOptions: { 
        rewriteRequestHeaders: (request, headers) => {
            const { host, ...forwardHeaders } = headers;
            return forwardHeaders;
        } 
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