export default async function (fastify, opts) {
  fastify.get('/:id', async function (request, reply) {
    console.log(request.headers,request.method)
    /*throw new Error('example error')*/
    return 'this is an example'
  })
}
