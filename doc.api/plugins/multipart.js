import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'

/**
 * This plugin for Fastify that adds support for parse the multipart content-type.
 *
 * @see https://github.com/fastify/fastify-multipart
 */
export default fp(async (fastify) => {
    fastify.register(multipart, {
        limits: {
            fieldNameSize: 100,      // Max field name size in bytes
            fieldSize: 100,          // Max field value size in bytes
            fields: 20,              // Max number of non-file fields
            fileSize: 1000000*5000,  // For multipart forms, the max file size in bytes
            files: 10,               // Max number of file fields
            headerPairs: 2000,       // Max number of header key=>value pairs
            parts: 1000              // For multipart forms, the max number of parts (fields + files)
        }
    })
})
