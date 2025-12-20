from io import BytesIO

from services.ocr import image_ocr_xin


def get_pdf_text(content, need_ocr=False):
    import pypdfium2
    import pypdfium2.raw as pdfium_c
    pdf_reader = pypdfium2.PdfDocument(content, autoclose=True)
    text = ''
    try:
        for page_number, page in enumerate(pdf_reader):
            images = page.get_objects(
                filter=(pdfium_c.FPDF_PAGEOBJ_IMAGE,),
                max_depth=1,
            )
            if need_ocr and len(list(images)) > 0:
                pil_image = page.render(
                    scale=2,
                    rotation=0,
                )
                output = BytesIO()
                pil_image.to_pil().save(output, 'jpeg')
                content = image_ocr_xin(output.getvalue())
                pil_image.close()
            else:
                text_page = page.get_textpage()
                content = text_page.get_text_range()
                text_page.close()
            images.close()
            page.close()
            text = text + content
    finally:
        pdf_reader.close()
    return text
