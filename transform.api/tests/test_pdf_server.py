"""pdf servicer 单元验证（无grpc直调）：中文typst源码 -> PDF字节
运行：uv run python tests/test_pdf_server.py
"""
from grpcs.servers import pdf_pb2, pdf_server


class _Ctx:
    def __init__(self):
        self.code = None
        self.details = None

    def set_code(self, code):
        self.code = code

    def set_details(self, details):
        self.details = details


SRC = '\n'.join([
    '#set text(font: ("Noto Sans CJK SC", "Noto Sans SC"), size: 11pt, lang: "zh", region: "cn")',
    '#set page(paper: "a4", margin: 2cm)',
    '#set heading(numbering: "1.")',
    '= 服务端PDF通道验证',
    '',
    '*思源黑体*渲染中文正常，表格与压力段落如下。',
    '',
    '| 项 | 值 |',
    '| 复制比 | 12% |',
    '',
    '压力测试段落。' * 80,
])


def main():
    ctx = _Ctx()
    resp = pdf_server.Pdf().compile(pdf_pb2.PdfCompileRequest(typSource=SRC), ctx)
    assert ctx.code is None, f'grpc错误: {ctx.code} {ctx.details}'
    assert resp.content[:5] == b'%PDF-', '非法PDF头'
    print('OK bytes=', len(resp.content))
    # 空源码分支
    ctx2 = _Ctx()
    pdf_server.Pdf().compile(pdf_pb2.PdfCompileRequest(typSource=''), ctx2)
    assert ctx2.code is not None, '空源码应报INVALID_ARGUMENT'
    print('OK empty-source rejected')


if __name__ == '__main__':
    main()
