import json, os, sys
from xml.sax.saxutils import escape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

with open(sys.argv[1], encoding='utf-8') as source:
    packet = json.load(source)
font_path = os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', 'arial.ttf')
pdfmetrics.registerFont(TTFont('ApplicationArial', font_path))
styles = getSampleStyleSheet()
normal = ParagraphStyle('Application', fontName='ApplicationArial', fontSize=10.5, leading=15, spaceAfter=10)
heading = ParagraphStyle('ApplicationHeading', parent=normal, fontSize=18, leading=23)
document = SimpleDocTemplate(sys.argv[2], pagesize=A4, rightMargin=58, leftMargin=58, topMargin=52, bottomMargin=52)
blocks = [Paragraph(escape(packet['name']), heading), Paragraph(escape(packet['email'] + ' · ' + packet['phone']), normal), Spacer(1, 12), Paragraph(escape('Application: ' + packet['title']), normal)]
blocks += [Paragraph(escape(text), normal) for text in packet['paragraphs']]
blocks.append(Paragraph(escape(packet['name']), normal))
document.build(blocks)
