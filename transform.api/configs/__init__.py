from dotenv import load_dotenv
import os

# 加载 .env 文件
load_dotenv()

# LLM OCR
openai_ocr_base_url = os.getenv('OPENAI_OCR_BASE_URL')
openai_ocr_api_key = os.getenv('OPENAI_OCR_API_KEY')
openai_ocr_model = os.getenv('OPENAI_OCR_MODEL')
xinference_ocr_base_url = os.getenv('XINFERENCE_OCR_BASE_URL')
xinference_ocr_api_key = os.getenv('XINFERENCE_OCR_API_KEY')
xinference_ocr_model = os.getenv('XINFERENCE_OCR_MODEL')

# xinference base url
xinference_base_url = os.getenv('XINFERENCE_BASE_URL')
