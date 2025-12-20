from grpcs.servers import helloworld_pb2_grpc, helloworld_pb2


class Greeter(helloworld_pb2_grpc.GreeterServicer):

    def SayHello(self, request, context):
        return helloworld_pb2.HelloReply(message='Hello, %s!' % request.name)


def register(server):
    helloworld_pb2_grpc.add_GreeterServicer_to_server(Greeter(), server)
