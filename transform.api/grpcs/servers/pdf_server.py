import os
import pathlib
import grpc
from grpcs.servers import pdf_pb2_grpc, pdf_pb2

import typst

# 字体解析策略：镜像已内置 fonts-noto-cjk（Noto Sans CJK SC，思源同源），系统字体优先；
# assets/fonts 存在时追加（本地开发自举/离线场景），typst 自动子集化嵌入，产物仅含用到的字形
_FONT_DIR = pathlib.Path(__file__).resolve().parents[2] / 'assets' / 'fonts'


class Pdf(pdf_pb2_grpc.PdfServicer):

    def compile(self, request, context):
        try:
            source = (request.typSource or '').encode('utf-8')
            if not source:
                context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
                context.set_details('typSource不能为空')
                return pdf_pb2.PdfCompileResponse()
            font_paths = [str(_FONT_DIR)] if _FONT_DIR.is_dir() else []
            content = typst.compile(
                {'main.typ': source},
                format='pdf',
                font_paths=font_paths,
                ignore_system_fonts=False,
            )
            return pdf_pb2.PdfCompileResponse(content=content)
        except Exception as e:
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f'PDF编译失败: {e}')
            return pdf_pb2.PdfCompileResponse()


def register(server):
    pdf_pb2_grpc.add_PdfServicer_to_server(Pdf(), server)
