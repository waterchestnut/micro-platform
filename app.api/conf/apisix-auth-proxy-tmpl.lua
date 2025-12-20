return function()
    local core = require 'apisix.core';
    local cjson = require 'cjson';
    local http = require 'resty.http';
    local tab_clone = require 'table.clone';
    local httpc = http.new();
    local uri = '{auth-upstream}/auth/check';
    local headers = tab_clone(ngx.req.get_headers());
    headers['content-length'] = nil;
    headers['content-type'] = 'application/json';
    headers['user-proxy'] = 'apisix';
    headers['param-path'] = ngx.var.request_uri;
    headers['param-method'] = ngx.var.request_method;
    local body = {
        path = ngx.var.request_uri,
        method = ngx.var.request_method
    };

    if (not headers['param-accessToken']) then
        local cookie_access = ngx.var['cookie_param-accessToken'];
        if (cookie_access) then
            headers['param-accessToken'] = cookie_access;
        end
    end

    local args = ngx.req.get_uri_args();
    if (args['accessToken']) then
        headers['param-accessToken'] = args['accessToken'];
    end

    local res, err = httpc:request_uri(uri, {
        method = 'POST',
        headers = headers,
        body = cjson.encode(body)
    });
    if not res then
        ngx.exit(403);
        return ;
    end

    local ret = cjson.decode(res.body);
    if ret.code == 0 then
        ngx.req.set_header('user-info', ret.data.userInfo);
        ngx.req.set_header('client-info', ret.data.clientInfo);
    else
        ngx.header['Content-Type'] = 'application/json';
        ngx.say(res.body);
        ngx.exit(res.status);
        return ;
    end
end