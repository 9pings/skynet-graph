#!/usr/bin/env python3
# md2tex.py — convertit les papiers markdown du dossier doc/papers/ en LaTeX (lualatex).
# Usage : python3 md2tex.py <in.md> <out.tex> [--lang fr|en]
# Déterministe et volontairement étroit : il couvre exactement le sous-ensemble markdown
# employé par ces papiers (titres, listes imbriquées, tables, citations, images+légendes,
# gras/italique/code, règles horizontales). Les images pointent vers figures/png/*.png.

import re, sys, pathlib

def esc(t):
    # échappement LaTeX du texte courant (hors code)
    t = t.replace('\\', r'\textbackslash{}')
    for a, b in [('&', r'\&'), ('%', r'\%'), ('#', r'\#'), ('_', r'\_'),
                 ('$', r'\$'), ('{', r'\{'), ('}', r'\}'), ('~', r'\textasciitilde{}'),
                 ('^', r'\textasciicircum{}')]:
        t = t.replace(a, b)
    return t

def inline(t):
    # code d'abord (protégé), puis gras, puis italique
    parts = re.split(r'(`[^`]*`)', t)
    out = []
    for p in parts:
        if p.startswith('`') and p.endswith('`') and len(p) > 1:
            out.append(r'\texttt{' + esc(p[1:-1]) + '}')
        else:
            p = esc(p)
            p = re.sub(r'\*\*\*(.+?)\*\*\*', r'\\textbf{\\emph{\1}}', p)
            p = re.sub(r'\*\*(.+?)\*\*', r'\\textbf{\1}', p)
            p = re.sub(r'(?<![\w*])\*([^*\n]+?)\*(?![\w*])', r'\\emph{\1}', p)
            out.append(p)
    return ''.join(out)

PREAMBLE = r'''% Généré par md2tex.py — ne pas éditer à la main ; éditer le .md maître et reconvertir.
% Compile : pdflatex (deux fois si besoin).
\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{textcomp}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,array}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{caption}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{newunicodechar}
\newunicodechar{·}{\ensuremath{\cdot}}
\newunicodechar{×}{\ensuremath{\times}}
\newunicodechar{÷}{\ensuremath{\div}}
\newunicodechar{¬}{\ensuremath{\neg}}
\newunicodechar{µ}{\ensuremath{\mu}}
\newunicodechar{²}{\textsuperscript{2}}
\newunicodechar{ᵉ}{\textsuperscript{e}}
\newunicodechar{′}{\ensuremath{'}}
\newunicodechar{Δ}{\ensuremath{\Delta}}
\newunicodechar{α}{\ensuremath{\alpha}}
\newunicodechar{β}{\ensuremath{\beta}}
\newunicodechar{δ}{\ensuremath{\delta}}
\newunicodechar{ε}{\ensuremath{\varepsilon}}
\newunicodechar{η}{\ensuremath{\eta}}
\newunicodechar{ρ}{\ensuremath{\rho}}
\newunicodechar{←}{\ensuremath{\leftarrow}}
\newunicodechar{→}{\ensuremath{\rightarrow}}
\newunicodechar{↔}{\ensuremath{\leftrightarrow}}
\newunicodechar{⇒}{\ensuremath{\Rightarrow}}
\newunicodechar{⟹}{\ensuremath{\Longrightarrow}}
\newunicodechar{∈}{\ensuremath{\in}}
\newunicodechar{−}{\ensuremath{-}}
\newunicodechar{∖}{\ensuremath{\setminus}}
\newunicodechar{∝}{\ensuremath{\propto}}
\newunicodechar{∧}{\ensuremath{\wedge}}
\newunicodechar{∪}{\ensuremath{\cup}}
\newunicodechar{≈}{\ensuremath{\approx}}
\newunicodechar{≡}{\ensuremath{\equiv}}
\newunicodechar{≤}{\ensuremath{\leq}}
\newunicodechar{≥}{\ensuremath{\geq}}
\newunicodechar{⊆}{\ensuremath{\subseteq}}
\newunicodechar{⊑}{\ensuremath{\sqsubseteq}}
\newunicodechar{⊘}{\ensuremath{\oslash}}
\newunicodechar{⊨}{\ensuremath{\models}}
\newunicodechar{▲}{\ensuremath{\blacktriangle}}
\newunicodechar{◇}{\ensuremath{\Diamond}}
\newunicodechar{✓}{\checkmark}
\newunicodechar{✕}{\ensuremath{\times}}
\setlist{nosep,leftmargin=1.5em}
\setlength{\parskip}{4pt}\setlength{\parindent}{0pt}
'''

def convert(src, lang):
    lines = src.split('\n')
    out = []
    i = 0
    title = ''
    author = ''
    # titre + auteur
    while i < len(lines):
        l = lines[i]
        if l.startswith('# '):
            title = inline(l[2:].strip()); i += 1; continue
        if l.startswith('**') and ('Braun' in l):
            author = inline(re.sub(r'\*\*', '', l).strip()); i += 1; continue
        if l.startswith('> '):  # bandeau : rendu en petite note
            note = []
            while i < len(lines) and lines[i].startswith('>'):
                note.append(lines[i].lstrip('> ')); i += 1
            out.append(r'\begin{center}\begin{minipage}{0.92\linewidth}\small\itshape ' +
                       inline(' '.join(note).replace('**', '')) + r'\end{minipage}\end{center}')
            continue
        if l.strip() in ('---', ''):
            i += 1
            if title and author:
                break
            continue
        break
    body = []
    listst = []  # pile de listes ('itemize'|'enumerate', indent)
    def close_lists(to_indent=-1):
        while listst and listst[-1][1] >= to_indent if to_indent >= 0 else listst:
            env, _ = listst.pop()
            body.append('\\end{%s}' % env)
    def close_all():
        while listst:
            env, _ = listst.pop()
            body.append('\\end{%s}' % env)
    n = len(lines)
    while i < n:
        l = lines[i]
        ls = l.strip()
        # bloc de code clôturé → verbatim
        if ls.startswith('```'):
            close_all()
            i += 1
            code = []
            while i < n and not lines[i].strip().startswith('```'):
                code.append(lines[i]); i += 1
            i += 1  # fence fermante
            body.append(r'\begin{small}\begin{verbatim}')
            body.extend(code)
            body.append(r'\end{verbatim}\end{small}')
            continue
        # fin / hr
        if ls == '---':
            close_all(); body.append('\\medskip\\hrule\\medskip'); i += 1; continue
        if ls == '':
            i += 1
            # une ligne vide ne ferme pas les listes (item + mini-paragraphe) ; on regarde la suite
            j = i
            while j < n and lines[j].strip() == '': j += 1
            if j < n and not re.match(r'^\s+', lines[j]) and not re.match(r'^\s*([-*]\s|\d+\.\s)', lines[j]):
                close_all()
            body.append('')
            continue
        # titres
        m = re.match(r'^(#{2,4})\s+(.*)$', l)
        if m:
            close_all()
            cmd = {2: 'section', 3: 'subsection', 4: 'subsubsection'}[len(m.group(1))]
            body.append('\\%s*{%s}' % (cmd, inline(m.group(2)))); i += 1; continue
        # citation (blockquote)
        if ls.startswith('>'):
            close_all()
            q = []
            while i < n and lines[i].strip().startswith('>'):
                q.append(lines[i].strip().lstrip('> ')); i += 1
            body.append('\\begin{quote}\\itshape ' + inline(' '.join(q)) + '\\end{quote}')
            continue
        # table
        if ls.startswith('|') and i + 1 < n and re.match(r'^\|[\s\-|:]+\|$', lines[i+1].strip()):
            close_all()
            header = [c.strip() for c in ls.strip('|').split('|')]
            i += 2
            rows = []
            while i < n and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            ncol = len(header)
            colspec = 'p{%.2f\\linewidth}' % (0.92 / ncol) * ncol if ncol > 3 else 'l' * ncol
            body.append('\\begin{center}\\small\\begin{tabular}{%s}\\toprule' % colspec)
            body.append(' & '.join(inline(h) for h in header) + ' \\\\ \\midrule')
            for r in rows:
                r = (r + [''] * ncol)[:ncol]
                body.append(' & '.join(inline(c) for c in r) + ' \\\\')
            body.append('\\bottomrule\\end{tabular}\\end{center}')
            continue
        # image + légende italique éventuelle
        m = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)\s*$', ls)
        if m:
            close_all()
            path = m.group(2)
            png = re.sub(r'^\.\./figures/', '../figures/png/', path).replace('.svg', '.png')
            cap = ''
            j = i + 1
            while j < n and lines[j].strip() == '': j += 1
            if j < n and lines[j].strip().startswith('*Figure'):
                capl = []
                while j < n and lines[j].strip() != '':
                    capl.append(lines[j].strip()); j += 1
                cap = ' '.join(capl).strip('*')
                i = j
            else:
                i += 1
            body.append('\\begin{figure}[htbp]\\centering')
            body.append('\\includegraphics[width=\\linewidth]{%s}' % png)
            if cap:
                body.append('\\caption*{\\small %s}' % inline(cap))
            body.append('\\end{figure}')
            continue
        # listes (imbrication par indentation, item + continuation)
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', l)
        if m:
            indent = len(m.group(1))
            kind = 'enumerate' if m.group(2)[0].isdigit() else 'itemize'
            while listst and listst[-1][1] > indent:
                env, _ = listst.pop(); body.append('\\end{%s}' % env)
            if not listst or listst[-1][1] < indent or listst[-1][0] != kind:
                if listst and listst[-1][1] == indent and listst[-1][0] != kind:
                    env, _ = listst.pop(); body.append('\\end{%s}' % env)
                listst.append((kind, indent)); body.append('\\begin{%s}' % kind)
            # rassembler l'item (continuations indentées, mini-paragraphes)
            item = [m.group(3)]
            i += 1
            while i < n:
                nxt = lines[i]
                if nxt.strip() == '':
                    # mini-paragraphe indenté ?
                    j = i
                    while j < n and lines[j].strip() == '': j += 1
                    if j < n and re.match(r'^\s{%d,}\S' % (indent + 2), lines[j]) and not re.match(r'^\s*([-*]|\d+\.)\s', lines[j]):
                        item.append('\\par')
                        i = j
                        continue
                    break
                if re.match(r'^\s*([-*]|\d+\.)\s', nxt):
                    break
                if re.match(r'^\s{%d,}\S' % (indent + 1), nxt):
                    item.append(nxt.strip()); i += 1; continue
                break
            body.append('\\item ' + inline(' '.join(item)))
            continue
        # paragraphe : rassembler
        close_all()
        para = [ls]
        i += 1
        while i < n and lines[i].strip() != '' and not lines[i].startswith('#') and \
              not lines[i].strip().startswith(('|', '>', '![', '---')) and \
              not re.match(r'^\s*([-*]|\d+\.)\s', lines[i]):
            para.append(lines[i].strip()); i += 1
        body.append(inline(' '.join(para)))
    close_all()
    abstractname = 'Résumé' if lang == 'fr' else 'Abstract'
    refname = 'Références' if lang == 'fr' else 'References'
    doc = PREAMBLE
    doc += '\\renewcommand{\\abstractname}{%s}\n' % abstractname
    doc += '\\title{\\textbf{%s}}\n\\author{%s}\n\\date{2026}\n' % (title, author)
    doc += '\\begin{document}\n\\maketitle\n'
    doc += '\n'.join(body)
    doc += '\n\\end{document}\n'
    return doc

if __name__ == '__main__':
    inp, outp = sys.argv[1], sys.argv[2]
    lang = 'fr' if '.fr.' in inp else 'en'
    if '--lang' in sys.argv:
        lang = sys.argv[sys.argv.index('--lang') + 1]
    src = pathlib.Path(inp).read_text(encoding='utf-8')
    pathlib.Path(outp).write_text(convert(src, lang), encoding='utf-8')
    print('wrote', outp)
