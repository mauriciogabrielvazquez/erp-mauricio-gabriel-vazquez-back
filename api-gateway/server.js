require('dotenv').config();
const Fastify = require('fastify');
const jwt = require('jsonwebtoken');
const rateLimit = require('@fastify/rate-limit');
const proxy = require('@fastify/http-proxy');

const fastify = Fastify({ logger: true });

const formatResponse = (statusCode, intOpCode, data) => ({ statusCode, intOpCode, data });

fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: function (request, context) {
        return formatResponse(429, 'SxGW429', { message: 'Too many requests' });
    }
});

fastify.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/auth/')) return;

    try {
        const authHeader = request.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return reply.code(403).send(formatResponse(403, 'SxGW403', { message: 'Token no proporcionado o formato inválido' }));
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        request.headers['x-user-id'] = decoded.userId;

    } catch (error) {
        fastify.log.error('Error de token:', error.message);
        return reply.code(403).send(formatResponse(403, 'SxGW403', { message: 'Token expirado o inválido' }));
    }
});

fastify.register(proxy, {
    upstream: 'http://localhost:3001',
    prefix: '/auth',
    rewritePrefix: '/auth'
});

fastify.register(proxy, {
    upstream: 'http://localhost:3001',
    prefix: '/users', 
    rewritePrefix: '/users'
});

fastify.register(proxy, {
    upstream: 'http://localhost:3002',
    prefix: '/tickets',
    rewritePrefix: '/tickets'
});

fastify.register(proxy, {
    upstream: 'http://localhost:3003',
    prefix: '/groups',
    rewritePrefix: '/groups'
});

const start = async () => {
    try {
        await fastify.listen({ port: process.env.PORT || 3000 });
        console.log(`API Gateway corriendo en el puerto ${process.env.PORT || 3000}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();