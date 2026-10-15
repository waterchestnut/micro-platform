import grpc

from grpcs.servers import renderer_pb2_grpc, renderer_pb2
from services import renderer


class Renderer(renderer_pb2_grpc.RendererServicer):

    def renderDemo(self, request, context):
        import json
        try:
            params = json.loads(request.params) if request.params else {}
        except Exception:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, 'params is not a valid JSON string')
            return renderer_pb2.DemoRenderResponse()
        try:
            ret = renderer.render_demo(
                request.kind,
                params=params,
                width=request.width or None,
                height=request.height or None,
                fps=request.fps or None,
                seconds=request.seconds or None,
            )
        except renderer.RenderError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return renderer_pb2.DemoRenderResponse()
        except Exception as e:
            context.abort(grpc.StatusCode.INTERNAL, 'render failed: %s' % e)
            return renderer_pb2.DemoRenderResponse()
        return renderer_pb2.DemoRenderResponse(video=ret['video'], poster=ret['poster'], meta=ret['meta'])


def register(server):
    renderer_pb2_grpc.add_RendererServicer_to_server(Renderer(), server)
