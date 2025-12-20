from grpcs.servers import converter_pb2_grpc, converter_pb2
from PIL import Image
from io import BytesIO


# wmf/emf图片格式的转换只支持windows系统
class Converter(converter_pb2_grpc.ConverterServicer):

    def convertImage(self, request, context):
        output = BytesIO()
        image = Image.open(BytesIO(request.content), 'r')
        try:
            # print(request.targetFormat)
            image.save(output, request.targetFormat)
            target_content = output.getvalue()
        finally:
            image.close()
            output.close()
        return converter_pb2.ImageConverterResponse(content=target_content)


def register(server):
    converter_pb2_grpc.add_ConverterServicer_to_server(Converter(), server)
