class ESApiAdapter {
    constructor(client, version) {
        this._client = client
        this._version = version
    }

    _wrapBody(params) {
        const { index, ...rest } = params
        return this._version === 'es9'
            ? params
            : { index, body: rest }
    }

    get client() {
        return this._client
    }

    get version() {
        return this._version
    }

    async search(params) {
        return this._client.search(this._wrapBody(params))
    }

    async analyze(params) {
        return this._client.indices.analyze(this._wrapBody(params))
    }

    async deleteByQuery(params, options = {}) {
        return this._client.deleteByQuery(this._wrapBody(params), options)
    }

    async bulk(params, options = {}) {
        if (this._version === 'es9') {
            const { index, body, ...rest } = params
            return this._client.bulk({ index, operations: body, ...rest }, options)
        }
        return this._client.bulk(params, options)
    }

    async get(params) {
        return this._client.get(params)
    }

    async delete(params, options = {}) {
        return this._client.delete(params, options)
    }
}

export default ESApiAdapter
