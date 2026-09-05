from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, black, white
from bidi.algorithm import get_display

pdfmetrics.registerFont(TTFont("DJ", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DJB", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))

W, H = 1190.55, 841.89  # A3 landscape
c = canvas.Canvas("porto_district_map_a3.pdf", pagesize=(W, H))
c.setTitle("Porto district municipalities")


def heb(s):
    return get_display(s, base_dir="R")


import porto_dist_geo as DG

DIST = {1:"0 km", 2:"2.9 km", 3:"7.7 km", 4:"9.6 km", 5:"6.7 km", 6:"10.4 km",
        7:"25 km", 8:"29 km", 9:"24 km", 10:"21 km", 11:"24 km", 12:"28 km",
        13:"24 km", 14:"31 km", 15:"42 km", 16:"46 km", 17:"39 km", 18:"48 km"}

MCOL = {1:"#F9C784",2:"#8FC4E8",3:"#A3D9D5",4:"#C5E1A5",5:"#F5B7B1",6:"#D7BDE2",
        7:"#B5C7E8",8:"#A8D5BA",9:"#F4A6A6",10:"#D4B8E0",11:"#E8C7A0",12:"#9FD8B0",
        13:"#F2D06B",14:"#E8A0A0",15:"#7FB3D5",16:"#D9E07A",17:"#F0B8D0",18:"#7FD4C1"}
polys = {k: (None, v) for k, v in MCOL.items()}

names = {
 1:("Porto","פורטו"), 2:("Vila Nova de Gaia","וילה נובה דה גאיה"),
 3:("Matosinhos","מטוזיניוש"), 4:("Maia","מאיה"),
 5:("Gondomar","גונדומאר"), 6:("Valongo","ולונגו"),
 7:("Vila do Conde","וילה דו קונדה"), 8:("Póvoa de Varzim","פובואה דה וארזים"),
 9:("Santo Tirso","סנטו טירסו"), 10:("Trofa","טרופה"),
 11:("Paredes","פארדש"), 12:("Penafiel","פנאפיאל"),
 13:("Paços de Ferreira","פאסוש דה פריירה"), 14:("Lousada","לוזאדה"),
 15:("Felgueiras","פלגיירש"), 16:("Amarante","אמרנטה"),
 17:("Marco de Canaveses","מרקו דה קנבזש"), 18:("Baião","באיאו"),
}

belts = [
 ("#1B4F8C", "החגורה העירונית", "Urban core", None, [1,2,3,4,5,6]),
 ("#2E7D32", "החגורה הצפונית", "Northern belt", None, [7,8,9,10,13,14,15]),
 ("#6A1B9A", "החגורה המזרחית", "Eastern belt", None, [11,12,16,17,18]),
]

# ---------- header ----------
c.setFont("DJB", 26); c.setFillColor(black)
c.drawString(40, 795, "Porto district")
c.drawRightString(1150, 795, heb("מחוז פורטו — 18 העיריות"))
c.setFont("DJ", 12); c.setFillColor(HexColor("#555555"))
c.drawString(40, 774, "18 municipalities \u00b7 boundaries: OpenStreetMap contributors (ODbL)")
c.setFont("DJ", 11)
c.drawRightString(1150, 774, heb("עמודת km — מרחק אווירי ממרכז העירייה למרכז פורטו"))
c.setStrokeColor(HexColor("#BBBBBB")); c.setLineWidth(1); c.line(40, 762, 1150, 762)

# ---------- real map ----------
mproj = DG.make_proj(40, 120, 520, 620)

def draw_geom(g, fill, stroke, lw):
    for r in DG.rings(g):
        p = c.beginPath()
        x, y = mproj(r[0]); p.moveTo(x, y)
        for q in r[1:]:
            x, y = mproj(q); p.lineTo(x, y)
        p.close()
        if fill: c.setFillColor(HexColor(fill))
        if stroke: c.setStrokeColor(HexColor(stroke)); c.setLineWidth(lw)
        c.drawPath(p, stroke=1 if stroke else 0, fill=1 if fill else 0)

for n in range(1, 19):
    draw_geom(DG.geom(n), MCOL[n], "#FFFFFF", 1.2)
for col, _hl, _el, _x, members in belts:
    draw_geom(DG.belt_union(members), None, col, 3.2)
draw_geom(DG.geom(1), None, "#8A5A12", 2.6)

for n in range(1, 19):
    x, y = mproj(DG.label_point(n))
    c.setFillColor(black); c.setFont("DJB", 12)
    c.drawCentredString(x, y - 4, str(n))

c.setFillColor(HexColor("#F9C784")); c.setStrokeColor(HexColor("#8A5A12")); c.setLineWidth(2)
c.rect(40, 96, 16, 16, stroke=1, fill=1)
c.setFillColor(black); c.setFont("DJB", 13); c.drawString(66, 100, "1")
c.setFont("DJ", 12); c.setFillColor(HexColor("#222222"))
c.drawString(80, 100, "Porto (the city itself) \u00b7 41 km\u00b2")
c.setFillColor(HexColor("#444444"))
c.drawString(370, 100, heb("פורטו העיר עצמה"))

# ---------- right panel ----------
X0, X1 = 610.0, 1150.0
y = 720.0
ROW = 28.0
for col, hl, el, _x, members in belts:
    box_h = 26 + len(members) * ROW + 12
    c.setStrokeColor(HexColor(col)); c.setLineWidth(3); c.setFillColor(white)
    c.roundRect(X0, y - box_h, X1 - X0, box_h, 8, stroke=1, fill=0)
    c.setFillColor(HexColor(col)); c.setFont("DJB", 14)
    c.drawString(X0 + 16, y - 20, el)
    c.drawRightString(X1 - 16, y - 20, heb(hl))
    ry = y - 26
    for m in members:
        c.setFillColor(HexColor(MCOL[m])); c.setStrokeColor(HexColor("#999999")); c.setLineWidth(0.8)
        c.rect(X0 + 16, ry - 21, 15, 15, stroke=1, fill=1)
        c.setFillColor(black); c.setFont("DJB", 13)
        c.drawRightString(X0 + 62, ry - 18, str(m))
        c.setFont("DJ", 12); c.setFillColor(HexColor("#222222"))
        c.drawString(X0 + 76, ry - 18, names[m][0])
        c.setFont("DJ", 11); c.setFillColor(HexColor("#666666"))
        c.drawRightString(X0 + 360, ry - 18, DIST[m])
        c.setFont("DJ", 12); c.setFillColor(HexColor("#444444"))
        c.drawRightString(X1 - 16, ry - 18, heb(names[m][1]))
        ry -= ROW
    y -= box_h + 14

c.setFont("DJ", 9); c.setFillColor(HexColor("#888888"))
c.drawRightString(X1, 34, heb("גבולות: OpenStreetMap · אינם מיועדים לשימוש רשמי"))
c.showPage()

# ================= belt pages =================
from porto_pages import PROFILES
from porto_freg2 import PENDING2, BELTS, TRANSPORT
from porto_freg3 import FREG3 as FREG2

DROP = ("\u05e9\u05db\u05d5\u05e0\u05d5\u05ea",)
X0C, X1C = 30.0, 1160.0
CWF = X1C - X0C
SUBW, SUBX = 350.0, [42.0, 422.0, 802.0]

def wrap2(txt, font, size, maxw):
    words, lines, cur = txt.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(t, font, size) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def fit(txt, font, size, maxw):
    t = txt
    while pdfmetrics.stringWidth(t, font, size) > maxw and len(t) > 4:
        t = t[:-2]
    return t + "\u2026" if t != txt else t

def prof_rows(num):
    return [r for r in PROFILES[num][3] if r[0] not in DROP]

def prof_h(num):
    h = 0
    for label, body in prof_rows(num):
        lw = pdfmetrics.stringWidth(heb(label + ":"), "DJB", 8.5)
        h += 11.2 * max(1, len(wrap2(body, "DJ", 8.5, CWF - 24 - lw - 8)))
    return h

def card_h(num):
    fl = FREG2.get(num)
    n = 11.2 * len(fl) if fl else 16.0
    return 26 + 16 + prof_h(num) + 10 + n + 14 + 12

def draw_card(x, ytop, num, belt):
    eng, hebn, _b, _r = PROFILES[num]
    H = card_h(num)
    c.setStrokeColor(HexColor(belt)); c.setLineWidth(2); c.setFillColor(white)
    c.roundRect(x, ytop - H, CWF, H, 7, stroke=1, fill=1)
    c.setFillColor(HexColor(polys[num][1]))
    c.rect(x + 1, ytop - 25, CWF - 2, 24, stroke=0, fill=1)
    c.setFillColor(black); c.setFont("DJB", 13)
    c.drawString(x + 12, ytop - 18, str(num))
    c.drawString(x + 34, ytop - 18, heb(hebn))
    hw = pdfmetrics.stringWidth(heb(hebn), "DJB", 13)
    c.setFont("DJ", 11); c.setFillColor(HexColor("#333333"))
    c.drawString(x + 40 + hw, ytop - 18, "(" + eng + ")")

    y = ytop - 39
    c.setFont("DJB", 8.5); c.setFillColor(HexColor(belt))
    lbl = heb("\u05de\u05e8\u05d7\u05e7 \u05d5\u05ea\u05d7\u05d1\u05d5\u05e8\u05d4:")
    c.drawRightString(x + CWF - 12, y, lbl)
    lw = pdfmetrics.stringWidth(lbl, "DJB", 8.5)
    c.setFont("DJ", 8.5); c.setFillColor(HexColor("#111111"))
    c.drawRightString(x + CWF - 12 - lw - 8, y,
                      heb(DIST[num] + " \u05d1\u05e7\u05d5 \u05d0\u05d5\u05d5\u05d9\u05e8\u05d9 \u00b7 " + TRANSPORT[num]))
    y -= 15

    for label, body in prof_rows(num):
        c.setFont("DJB", 8.5); c.setFillColor(HexColor(belt))
        c.drawRightString(x + CWF - 12, y, heb(label + ":"))
        lw = pdfmetrics.stringWidth(heb(label + ":"), "DJB", 8.5)
        first = True
        c.setFont("DJ", 8.5); c.setFillColor(HexColor("#222222"))
        for ln in wrap2(body, "DJ", 8.5, CWF - 24 - lw - 8):
            c.drawRightString(x + CWF - 12 - (lw + 8 if first else 0), y, heb(ln))
            y -= 11.2; first = False

    y -= 5
    c.setStrokeColor(HexColor("#DDDDDD")); c.setLineWidth(0.7)
    c.line(x + 12, y, x + CWF - 12, y)
    y -= 11
    fl = FREG2.get(num)
    RH, RE, RP, RD = x + CWF - 12, x + CWF - 165, x + CWF - 370, x + CWF - 425
    if not fl:
        c.setFont("DJ", 8.0); c.setFillColor(HexColor("#8A2A00"))
        c.drawRightString(RH, y,
            heb("{} \u05e4\u05e8\u05d2\u05d6\u05d9\u05d5\u05ea \u2014 \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05d8\u05e8\u05dd \u05d0\u05d5\u05de\u05ea\u05d4 \u05de\u05de\u05e7\u05d5\u05e8 \u05de\u05d4\u05d9\u05de\u05df".format(PENDING2[num])))
    else:
        for k, (fhb, feng, fpop, fdesc) in enumerate(fl):
            yy = y - k * 11.2
            if k % 2 == 1:
                c.setFillColor(HexColor("#F4F4F4"))
                c.rect(x + 10, yy - 3, CWF - 20, 11.2, stroke=0, fill=1)
            c.setFont("DJB", 8.0); c.setFillColor(HexColor("#111111"))
            c.drawRightString(RH, yy, heb(fit(fhb, "DJB", 8.0, 148)))
            c.setFont("DJ", 7.8); c.setFillColor(HexColor("#3A3A3A"))
            c.drawRightString(RE, yy, fit(feng, "DJ", 7.8, 198))
            c.setFont("DJ", 7.8); c.setFillColor(HexColor("#666666"))
            c.drawRightString(RP, yy, "{:,}".format(fpop) if fpop else "n/a")
            c.setFont("DJ", 7.8); c.setFillColor(HexColor("#333333"))
            c.drawRightString(RD, yy, heb(fit(fdesc, "DJ", 7.8, RD - x - 14)))
    c.setFillColor(HexColor(belt))
    c.rect(x + 1, ytop - H + 1, CWF - 2, 13, stroke=0, fill=1)
    return H

def belt_header(belt, b_he, b_en, intro_he, cont):
    c.setFont("DJB", 22); c.setFillColor(HexColor(belt))
    t = heb(b_he) + ("  " + heb("(\u05d4\u05de\u05e9\u05da)") if cont else "")
    c.drawRightString(X1C, 802, t)
    c.setFont("DJ", 15); c.setFillColor(HexColor("#555555"))
    w = pdfmetrics.stringWidth(t, "DJB", 22)
    c.drawRightString(X1C - w - 12, 802, "(" + b_en + ")")
    c.setStrokeColor(HexColor(belt)); c.setLineWidth(2.5); c.line(X0C, 792, X1C, 792)
    if cont:
        return 776
    c.setFont("DJ", 10.5); c.setFillColor(HexColor("#222222"))
    yy = 776
    for ln in wrap2(intro_he, "DJ", 10.5, CWF - 10):
        c.drawRightString(X1C, yy, heb(ln)); yy -= 14
    return yy - 8

for belt, b_en, b_he, members, _ien, intro_he in BELTS:
    cont = False
    y = belt_header(belt, b_he, b_en, intro_he, cont)
    for num in members:
        h = card_h(num)
        if y - h < 28:
            c.showPage(); cont = True
            y = belt_header(belt, b_he, b_en, intro_he, cont)
        draw_card(X0C, y, num, belt)
        y -= h + 12
    c.showPage()

c.setFont("DJB", 22); c.setFillColor(black)
c.drawString(30, 792, "Administrative hierarchy")
c.setFont("DJB", 22)
c.drawRightString(1160, 792, heb("\u05e2\u05e5 \u05d4\u05d7\u05dc\u05d5\u05e7\u05d4 \u05d4\u05de\u05e0\u05d4\u05dc\u05d9\u05ea"))
c.setStrokeColor(HexColor("#BBBBBB")); c.setLineWidth(1); c.line(30, 776, 1160, 776)

levels = [
 ("#333333", "Portugal", "\u05e4\u05d5\u05e8\u05d8\u05d5\u05d2\u05dc", "the state", "\u05d4\u05de\u05d3\u05d9\u05e0\u05d4"),
 ("#8A2A00", "Distrito do Porto", "\u05de\u05d7\u05d5\u05d6 \u05e4\u05d5\u05e8\u05d8\u05d5", "1 of 18 districts \u00b7 statistical unit, no elected body",
  "\u05d9\u05d7\u05d9\u05d3\u05d4 \u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05ea \u2014 \u05d0\u05d9\u05df \u05dc\u05d4 \u05e9\u05dc\u05d8\u05d5\u05df \u05e0\u05d1\u05d7\u05e8"),
 ("#1B4F8C", "18 concelhos / municipios", "18 \u05e2\u05d9\u05e8\u05d9\u05d5\u05ea", "elected camara municipal \u00b7 budget, planning, licensing",
  "\u05e8\u05e9\u05d5\u05ea \u05e0\u05d1\u05d7\u05e8\u05ea \u2014 \u05ea\u05e7\u05e6\u05d9\u05d1, \u05ea\u05db\u05e0\u05d5\u05df \u05d5\u05e8\u05d9\u05e9\u05d5\u05d9"),
 ("#2E7D32", "~250 freguesias", "\u05db-250 \u05e4\u05e8\u05d2\u05d6\u05d9\u05d5\u05ea", "elected junta de freguesia \u00b7 streets, parks, civil registry",
  "\u05de\u05e0\u05d4\u05dc\u05d4 \u05e0\u05d1\u05d7\u05e8\u05ea \u2014 \u05e8\u05d7\u05d5\u05d1\u05d5\u05ea, \u05d2\u05e0\u05d9\u05dd, \u05e8\u05d9\u05e9\u05d5\u05dd"),
 ("#6A1B9A", "lugares / bairros", "\u05e9\u05db\u05d5\u05e0\u05d5\u05ea \u05d5\u05de\u05e7\u05d5\u05de\u05d5\u05ea", "NOT an administrative layer \u00b7 names in use, no borders or budget",
  "\u05dc\u05d0 \u05e9\u05db\u05d1\u05d4 \u05de\u05e0\u05d4\u05dc\u05d9\u05ea \u2014 \u05e9\u05de\u05d5\u05ea \u05d1\u05dc\u05d1\u05d3, \u05dc\u05dc\u05d0 \u05d2\u05d1\u05d5\u05dc \u05d0\u05d5 \u05ea\u05e7\u05e6\u05d9\u05d1"),
]

ty3 = 720.0
for i, (col, en, hb, sub_en, sub_he) in enumerate(levels):
    x = 60 + i * 46
    w = 1090 - i * 46 - 30
    c.setFillColor(HexColor(col))
    c.roundRect(x, ty3 - 46, w, 46, 6, stroke=0, fill=1)
    c.setFillColor(white); c.setFont("DJB", 14)
    c.drawString(x + 14, ty3 - 20, en)
    c.setFont("DJ", 9)
    c.drawString(x + 14, ty3 - 36, sub_en)
    c.setFont("DJB", 13)
    c.drawRightString(x + w - 14, ty3 - 20, heb(hb))
    c.setFont("DJ", 9)
    c.drawRightString(x + w - 14, ty3 - 36, heb(sub_he))
    if i < len(levels) - 1:
        c.setStrokeColor(HexColor("#AAAAAA")); c.setLineWidth(1.5)
        c.line(x + 22, ty3 - 46, x + 22, ty3 - 62)
    ty3 -= 62

c.setFont("DJB", 12); c.setFillColor(black)
c.drawString(60, 400, "Worked example")
c.drawRightString(1120, 400, heb("\u05d3\u05d5\u05d2\u05de\u05d4"))
chain = [("Portugal", "#333333"), ("Distrito do Porto", "#8A2A00"), ("Gondomar", "#1B4F8C"),
         ("F\u00e2nzeres e S\u00e3o Pedro da Cova", "#2E7D32"), ("S\u00e3o Pedro da Cova", "#6A1B9A")]
cx = 60
for i, (lab, col) in enumerate(chain):
    w = pdfmetrics.stringWidth(lab, "DJ", 11) + 22
    c.setFillColor(HexColor(col))
    c.roundRect(cx, 360, w, 26, 5, stroke=0, fill=1)
    c.setFillColor(white); c.setFont("DJ", 11)
    c.drawCentredString(cx + w / 2, 369, lab)
    cx += w
    if i < len(chain) - 1:
        c.setFillColor(HexColor("#777777")); c.setFont("DJB", 13)
        c.drawCentredString(cx + 11, 369, ">")
        cx += 22

c.setFont("DJ", 10); c.setFillColor(HexColor("#444444"))
c.drawRightString(1120, 330, heb("\u05d1\u05de\u05d5\u05d3\u05e2\u05d5\u05ea \u05d0\u05d9\u05d3\u05d9\u05d0\u05dc\u05d9\u05e1\u05d8\u05d4 \u2014 \u05e9\u05ea\u05d9 \u05d4\u05e8\u05de\u05d5\u05ea \u05d4\u05d0\u05d7\u05e8\u05d5\u05e0\u05d5\u05ea \u05d4\u05df \u05e9\u05de\u05d5\u05ea \u05d4\u05de\u05e7\u05d5\u05dd \u05e9\u05d1\u05db\u05ea\u05d5\u05d1\u05ea"))

c.setStrokeColor(HexColor("#CCCCCC")); c.setLineWidth(1); c.line(60, 250, 1120, 250)
c.setFont("DJB", 13); c.setFillColor(black)
c.drawString(60, 224, "Source \u2014 PORDATA")
c.drawRightString(1120, 224, heb("\u05de\u05e7\u05d5\u05e8 \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u2014 PORDATA"))
c.setFont("DJ", 11); c.setFillColor(HexColor("#1B4F8C"))
c.drawString(60, 202, "https://www.pordata.pt")
c.linkURL("https://www.pordata.pt", (60, 196, 260, 214), relative=0)
c.drawString(60, 184, "https://retratos.pordata.pt   \u2014 municipality portraits")
c.linkURL("https://retratos.pordata.pt", (60, 178, 300, 196), relative=0)
c.drawString(60, 166, "https://www.pordata.pt/municipios   \u2014 municipal database")
c.linkURL("https://www.pordata.pt/municipios", (60, 160, 330, 178), relative=0)
c.setFont("DJ", 10); c.setFillColor(HexColor("#555555"))
c.drawRightString(1120, 202, heb("\u05de\u05e1\u05d3 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9 \u05d7\u05d9\u05e0\u05de\u05d9"))
c.drawRightString(1120, 186, "Fundacao Francisco Manuel dos Santos")
c.drawRightString(1120, 170, heb("\u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05de\u05e7\u05d5\u05e8\u05dd \u05d1-INE, \u05dc\u05e9\u05db\u05ea \u05d4\u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4 \u05d4\u05dc\u05d0\u05d5\u05de\u05d9\u05ea"))
c.showPage()



# ================= Porto city pages (real OSM geometry) =================
from porto_city import PORTO_FREG, BAIRROS
import porto_geo as G

def pg_header(he, en, sub_he):
    c.setFont("DJB", 21); c.setFillColor(black)
    t = heb(he); c.drawRightString(1160, 802, t)
    w = pdfmetrics.stringWidth(t, "DJB", 21)
    c.setFont("DJ", 14); c.setFillColor(HexColor("#444444"))
    c.drawRightString(1160 - w - 12, 802, "(" + en + ")")
    c.setStrokeColor(HexColor("#8A5A12")); c.setLineWidth(2.5); c.line(30, 792, 1160, 792)
    c.setFont("DJ", 10.5); c.setFillColor(HexColor("#333333"))
    yy = 776
    for ln in wrap2(sub_he, "DJ", 10.5, 1120):
        c.drawRightString(1160, yy, heb(ln)); yy -= 14
    return yy - 6

def path_ring(ring, proj):
    p = c.beginPath()
    x, y = proj(ring[0]); p.moveTo(x, y)
    for q in ring[1:]:
        x, y = proj(q); p.lineTo(x, y)
    p.close()
    return p

FCOL = {n: col for n, _h, _e, _p, col, _d in PORTO_FREG}

# ---------- page: Porto and its 7 freguesias ----------
pg_header("עיריית פורטו — שבעת הרבעים", "Porto \u2014 the seven freguesias",
          "גבולות הרבעים לפי OpenStreetMap (admin_level 8) — גיאוגרפיה אמיתית, לא סכמטית. "
          "מספרי התושבים ממפקד 2021.")

rings = [G.FREG_RING[G.FNUM[n]] for n in range(1, 8)]
proj = G.make_proj(rings, 30, 200, 520, 500)
for n in range(1, 8):
    r = G.FREG_RING[G.FNUM[n]]
    c.setFillColor(HexColor(FCOL[n])); c.setStrokeColor(white); c.setLineWidth(1.6)
    c.drawPath(path_ring(r, proj), stroke=1, fill=1)
for n in range(1, 8):
    r = G.FREG_RING[G.FNUM[n]]
    pts = [proj(q) for q in r]
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    c.setFillColor(black); c.setFont("DJB", 15)
    c.drawCentredString(cx, cy - 5, str(n))
c.setFont("DJ", 9); c.setFillColor(HexColor("#777777"))
c.drawString(30, 190, "boundaries: OpenStreetMap contributors (ODbL)")

xR, yR = 590.0, 700.0
for num, hb, en, pop, col, desc in PORTO_FREG:
    c.setFillColor(HexColor(col)); c.setStrokeColor(HexColor("#999999")); c.setLineWidth(0.8)
    c.rect(xR, yR - 15, 15, 15, stroke=1, fill=1)
    c.setFont("DJB", 12); c.setFillColor(black)
    c.drawString(xR + 22, yR - 12, str(num))
    c.setFont("DJB", 11); c.drawRightString(1160, yR - 12, heb(hb))
    yR -= 26
    c.setFont("DJ", 9); c.setFillColor(HexColor("#555555"))
    c.drawRightString(1160, yR, en + "  \u00b7  " + "{:,}".format(pop) + " residents")
    yR -= 13
    c.setFont("DJ", 8.3); c.setFillColor(HexColor("#222222"))
    for ln in wrap2(desc, "DJ", 8.3, 1160 - xR - 6):
        c.drawRightString(1160, yR, heb(ln)); yR -= 10.6
    yR -= 9
c.showPage()

# ---------- one page per freguesia ----------
for num, hb, en, pop, col, _d in PORTO_FREG:
    ttl_he, ttl_en, base, zones = BAIRROS[num]
    pg_header("רובע {} \u2014 {}".format(num, ttl_he), ttl_en,
              "גבול הרובע לפי OpenStreetMap. העיגולים הממוספרים הם שמות המקום המקובלים, "
              "ממוקמים לפי הקואורדינטות שלהם ב-OSM; עיגול חלול = מיקום משוער שלא נמצא במאגר. "
              "לשכונות אין גבולות מנהליים רשמיים.")

    own = G.FREG_RING[G.FNUM[num]]
    proj = G.make_proj([own], 620, 170, 540, 540)
    for m in range(1, 8):
        if m == num:
            continue
        c.setFillColor(HexColor("#EFEFEF")); c.setStrokeColor(HexColor("#DDDDDD")); c.setLineWidth(0.8)
        c.drawPath(path_ring(G.FREG_RING[G.FNUM[m]], proj), stroke=1, fill=1)
    c.setFillColor(HexColor(col)); c.setStrokeColor(HexColor("#333333")); c.setLineWidth(2)
    c.drawPath(path_ring(own, proj), stroke=1, fill=1)

    for pname, ppt in G.places_in(num):
        x, y = proj(ppt)
        c.setFillColor(HexColor("#FFFFFF")); c.setStrokeColor(HexColor("#AAAAAA")); c.setLineWidth(0.5)
        c.circle(x, y, 1.6, stroke=1, fill=1)

    lo, la, lo1, la1 = G.bbox([own])
    for i, (cx0, ry, sp, zhe, zen, zdesc) in enumerate(zones):
        pt, found = G.find_place(num, zen)
        if pt is None:
            nrows = max(z[1] for z in zones) + 1
            pt = [lo + (cx0 + sp / 2.0) / 4.0 * (lo1 - lo),
                  la1 - (ry + 0.5) / float(nrows) * (la1 - la)]
        x, y = proj(pt)
        c.setFillColor(HexColor("#1B4F8C") if found else HexColor("#FFFFFF"))
        c.setStrokeColor(HexColor("#1B4F8C")); c.setLineWidth(1.4)
        c.circle(x, y, 8.5, stroke=1, fill=1)
        c.setFillColor(white if found else HexColor("#1B4F8C"))
        c.setFont("DJB", 9)
        c.drawCentredString(x, y - 3, str(i + 1))
    c.setFont("DJ", 8.5); c.setFillColor(HexColor("#777777"))
    c.drawString(620, 158, "boundaries & place points: OpenStreetMap contributors (ODbL)")

    yL = 700.0
    for i, (_a, _b, _c2, zhe, zen, zdesc) in enumerate(zones):
        c.setFillColor(HexColor("#1B4F8C"))
        c.circle(37, yL - 8, 8.5, stroke=0, fill=1)
        c.setFillColor(white); c.setFont("DJB", 9)
        c.drawCentredString(37, yL - 11, str(i + 1))
        c.setFont("DJB", 10.5); c.setFillColor(black)
        c.drawRightString(575, yL - 11, heb(zhe))
        c.setFont("DJ", 8.5); c.setFillColor(HexColor("#555555"))
        c.drawString(55, yL - 11, zen)
        yL -= 25
        c.setFont("DJ", 8.6); c.setFillColor(HexColor("#222222"))
        for ln in wrap2(zdesc, "DJ", 8.6, 545):
            c.drawRightString(575, yL, heb(ln)); yL -= 11
        yL -= 8
    c.showPage()


c.save()
print("ok")
