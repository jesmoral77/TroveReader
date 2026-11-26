#!/usr/bin/env python3
"""
Generates a small demo library (EPUB, PDF, CBZ, Markdown, text) in ./demo for
developing Trove in a plain browser (`npm run dev`, then open /?demo).
All titles, authors and text are invented. Requires: reportlab, Pillow.
"""
import io
import json
import os
import random
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph, Spacer, Image as RLImage

ROOT = Path(__file__).resolve().parent.parent / "demo"
FONT_DIR = "/usr/share/fonts/truetype/dejavu"
random.seed(7)

PARAS = [
    "Attention is not a spotlight so much as a habit of return. We drift, and the work is to notice the drift without "
    "scolding ourselves for it, then to come back to the page, the sentence, the person across the table.",
    "Every good strategy begins as a description. Before you can decide where to go, you have to say plainly where you "
    "are, what you have, and what the people you serve are actually trying to get done on an ordinary Tuesday.",
    "The early network was a conversation among a few hundred people who mostly trusted one another. Its protocols "
    "reflect that trust: they assume good faith, tolerate failure, and route around damage rather than prevent it.",
    "A story earns attention by making a promise and then delaying its fulfilment. The delay is not padding; it is the "
    "space in which the listener starts to care, to guess, and to lean forward.",
    "Craft is the accumulation of small decisions that nobody will notice individually. Taken together they are the "
    "difference between something that works and something that feels inevitable.",
    "When a team cannot agree, it is often because each person is answering a different question. Writing the question "
    "down, in one sentence, on the wall, resolves more arguments than any amount of persuasion.",
    "Pricing is a story you tell about value. Tell it badly and customers will invent their own version, which is almost "
    "always cheaper than yours.",
    "Long walks do for thinking what editing does for prose: they remove what does not belong until the shape of the "
    "thing becomes visible.",
    "Trust is built in small deposits and spent in large withdrawals. The ledger is never visible, but everyone keeps one.",
    "Networks reward the patient. The introduction you make today pays back in a conversation three years from now that "
    "neither of you could have predicted.",
]


def prose(n, seed):
    r = random.Random(seed)
    return [r.choice(PARAS) for _ in range(n)]


def font(size, bold=False, mono=False, serif=False):
    name = "DejaVuSansMono" if mono else ("DejaVuSerif" if serif else "DejaVuSans")
    if bold:
        name += "-Bold"
    return ImageFont.truetype(f"{FONT_DIR}/{name}.ttf", size)


def wrap(draw, text, fnt, width):
    words, lines, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=fnt) <= width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def cover_image(title, author, bg, fg, style):
    W, H = 600, 900
    im = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(im)
    r = random.Random(title)
    if style == "rings":
        for i in range(12, 0, -1):
            c = tuple(int(bg[j] + (fg[j] - bg[j]) * (i / 14)) for j in range(3))
            d.ellipse((W / 2 - i * 26, 380 - i * 26, W / 2 + i * 26, 380 + i * 26), outline=c, width=3)
    elif style == "blocks":
        for _ in range(9):
            x, y = r.randint(0, W - 120), r.randint(260, 700)
            c = tuple(min(255, int(v * r.uniform(0.6, 1.4))) for v in fg)
            d.rectangle((x, y, x + r.randint(60, 220), y + r.randint(40, 160)), fill=c)
    elif style == "stripes":
        for i in range(0, H, 36):
            d.rectangle((0, i, W, i + 14), fill=tuple(int(v * 0.85) for v in bg))
        d.rectangle((60, 260, W - 60, 620), fill=fg)
    else:  # grid of dots
        for x in range(40, W, 44):
            for y in range(300, 760, 44):
                d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=fg)
    tf = font(58, bold=True, serif=True)
    lines = wrap(d, title.upper(), tf, W - 100)
    y = 70
    for ln in lines:
        d.text((50, y), ln, font=tf, fill=fg if style != "stripes" else (250, 248, 240))
        y += 68
    d.text((50, H - 90), author, font=font(30, serif=True), fill=fg if style != "stripes" else (250, 248, 240))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# EPUB
# ---------------------------------------------------------------------------

def make_epub(path, title, author, chapters, cover):
    uid = f"urn:uuid:trove-demo-{abs(hash(title)) % 10**12}"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )
        manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
                    '<item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
                    '<item id="css" href="style.css" media-type="text/css"/>']
        spine = []
        nav = []
        for i, (ctitle, paras) in enumerate(chapters, 1):
            body = "".join(f"<p>{p}</p>" for p in paras)
            z.writestr(
                f"OEBPS/ch{i}.xhtml",
                f'<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
                f'<head><title>{ctitle}</title><link rel="stylesheet" href="style.css"/></head><body><section epub:type="chapter">'
                f"<h2>{ctitle}</h2>{body}</section></body></html>",
            )
            manifest.append(f'<item id="ch{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>')
            spine.append(f'<itemref idref="ch{i}"/>')
            nav.append(f'<li><a href="ch{i}.xhtml">{ctitle}</a></li>')
        z.writestr("OEBPS/style.css", "h2{margin:2em 0 1em;font-weight:600} p{margin:0;text-indent:1.4em} h2+p{text-indent:0}")
        z.writestr("OEBPS/cover.jpg", cover)
        z.writestr(
            "OEBPS/nav.xhtml",
            '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'
            f'<head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol>{"".join(nav)}</ol></nav></body></html>',
        )
        z.writestr(
            "OEBPS/content.opf",
            f'<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">'
            f'<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">{uid}</dc:identifier>'
            f"<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator><dc:language>en</dc:language>"
            f'<dc:publisher>Trove Demo Press</dc:publisher><dc:date>2024-01-01</dc:date>'
            f'<meta property="dcterms:modified">2024-01-01T00:00:00Z</meta><meta name="cover" content="cover"/></metadata>'
            f'<manifest>{"".join(manifest)}</manifest><spine>{"".join(spine)}</spine></package>',
        )


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

class OutlineDoc(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=self._footer)])
        self._n = 0

    def _footer(self, canv, doc):
        canv.setFont("Helvetica", 8)
        canv.setFillGray(0.5)
        canv.drawCentredString(LETTER[0] / 2, 0.5 * inch, str(doc.page))

    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and f.style.name == "Heading1":
            key = f"h{self._n}"
            self._n += 1
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.getPlainText(), key, level=0)


def make_pdf(path, title, author, sections, paras_per_section, cover_jpeg=None, abstract=True):
    styles = getSampleStyleSheet()
    body = ParagraphStyle("b", parent=styles["BodyText"], fontName="Times-Roman", fontSize=11, leading=15, spaceAfter=8)
    doc = OutlineDoc(str(path), pagesize=LETTER, title=title, author=author, leftMargin=inch, rightMargin=inch, topMargin=inch, bottomMargin=inch)
    story = []
    if cover_jpeg:
        story.append(RLImage(io.BytesIO(cover_jpeg), width=420, height=630))
        story.append(PageBreak())
    story.append(Paragraph(title, styles["Title"]))
    story.append(Paragraph(author, ParagraphStyle("a", parent=styles["Normal"], alignment=1, fontSize=12, spaceAfter=18)))
    if abstract:
        story.append(Paragraph("<b>Abstract.</b> " + " ".join(prose(3, title)), body))
    for i, s in enumerate(sections):
        story.append(Paragraph(s, styles["Heading1"]))
        for p in prose(paras_per_section, f"{title}{i}"):
            story.append(Paragraph(p, body))
        story.append(Spacer(1, 6))
    doc.build(story)


def make_cbz(path, title):
    with zipfile.ZipFile(path, "w") as z:
        for i in range(1, 7):
            im = Image.new("RGB", (800, 1200), (245, 240, 228))
            d = ImageDraw.Draw(im)
            r = random.Random(i)
            for px, py in [(40, 40), (420, 40), (40, 620), (420, 620)]:
                d.rectangle((px, py, px + 340, py + 540), outline=(30, 30, 30), width=6)
                for _ in range(4):
                    cx, cy = px + r.randint(40, 300), py + r.randint(60, 480)
                    d.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=tuple(r.randint(60, 220) for _ in range(3)))
            d.text((60, 1150 - 40), f"{title} - page {i}", font=font(28, bold=True), fill=(30, 30, 30))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=80)
            z.writestr(f"{i:03d}.jpg", buf.getvalue())


def main():
    ROOT.mkdir(exist_ok=True)
    for f in ROOT.iterdir():
        f.unlink()

    books = [
        ("The Quiet Engine", "Mara Ellison", (34, 55, 122), (230, 200, 90), "rings"),
        ("Rivers Without Maps", "Tomas Okafor", (196, 92, 52), (250, 238, 220), "stripes"),
        ("A Field Guide to Attention", "Ines Calder", (240, 236, 226), (40, 70, 60), "dots"),
        ("The Long Table", "Ruth Abernathy", (70, 40, 75), (225, 190, 230), "blocks"),
        ("Signal and Kinship", "Dev Raman", (22, 26, 30), (230, 80, 60), "rings"),
    ]
    for title, author, bg, fg, style in books:
        chapters = [(f"{n}. {t}", prose(28, title + t)) for n, t in enumerate(
            ["Beginnings", "The Inventory", "Small Decisions", "Patience", "Returning", "What Remains"], 1)]
        make_epub(ROOT / f"{title}.epub", title, author, chapters, cover_image(title, author, bg, fg, style))

    long_pdfs = [
        ("Building Trust at Work", "Helena Voss", (245, 245, 238), (20, 60, 120), "blocks"),
        ("Where the Network Began", "Paul Hendry and Ana Ruiz", (20, 18, 30), (220, 40, 50), "stripes"),
    ]
    for title, author, bg, fg, style in long_pdfs:
        make_pdf(ROOT / f"{title}.pdf", title, author, [f"Chapter {i}" for i in range(1, 15)], 40,
                 cover_jpeg=cover_image(title, author, bg, fg, style), abstract=False)

    papers = [
        ("Effectual Reasoning in Early Ventures", "S. Reed, N. Dew"),
        ("Pricing Playbook", "Erin Hale"),
        ("Supercharge Your Profile", "Erin Hale"),
        ("Activate Your Network", "Erin Hale"),
        ("Lead Generation Made Simple", "Erin Hale"),
        ("Strategy Tactics Cards", "Deck Studio"),
        ("Storyteller Tactics", "Deck Studio"),
        ("Brand Tactics", "Deck Studio"),
        ("Archetypes for Storytellers", "Deck Studio"),
        ("Me as a Service", "Behrad Sirani"),
        ("Start Doing the Work", "Behrad Sirani"),
        ("Little Grey Book of Leadership", ""),
        ("Agile Strategy Guide", ""),
        ("Comms Strategy in Ten Rules", "Lin Cheng"),
        ("The Artist and Integrity", "J. Baldwin-Hart"),
        ("Phenomenology of the Hand", "Memoria Press"),
    ]
    for title, author in papers:
        make_pdf(ROOT / f"{title.replace(' ', '_')}.pdf", title, author or "", ["Introduction", "Framework", "Practice", "Notes"], 6)

    (ROOT / "Notes on Dialogue.md").write_text(
        "# Notes on Dialogue\n\nAuthor: Trove Demo\n\n" + "\n\n".join(
            f"## {h}\n\n" + "\n\n".join(prose(5, h)) for h in ["Listening first", "Questions that open", "Holding tension", "Closing well"]))
    (ROOT / "Call transcript - studio kickoff.txt").write_text("\n\n".join(prose(40, "transcript")))
    make_cbz(ROOT / "Panels and Pauses.cbz", "Panels and Pauses")

    manifest = [{"file": f.name, "size": f.stat().st_size} for f in sorted(ROOT.iterdir()) if f.name != "manifest.json"]
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"Wrote {len(manifest)} demo files to {ROOT}")


if __name__ == "__main__":
    main()
