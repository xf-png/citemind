"""Optional fixture regeneration; python-docx 1.2.0 is not a runtime dependency."""
from pathlib import Path
from docx import Document

target = Path(__file__).resolve().parents[1] / "fixtures" / "word-inventory.docx"
target.parent.mkdir(exist_ok=True)
document = Document()
document.add_heading("真实 Word 兼容样例", 0)
document.add_paragraph("采购记录：保质期十八个月。")
table = document.add_table(rows=2, cols=2)
table.cell(0, 0).text = "商品"
table.cell(0, 1).text = "库存"
table.cell(1, 0).text = "白茶"
table.cell(1, 1).text = "十箱"
document.sections[0].header.paragraphs[0].text = "不应导入的页眉"
document.sections[0].footer.paragraphs[0].text = "不应导入的页脚"
document.save(target)
print(target)
