export default async function (fastify, opts) {
    fastify.get('/', async function (request, reply) {
        return {msg: 'this is an example'}
    })
}
