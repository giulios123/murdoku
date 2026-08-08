import type { ReactNode } from 'react'
import { Renderer } from '../i18n/Renderer.ts'
import type { Explanation, PersonId } from '../engine/index.ts'
import InfoTip from './InfoTip.tsx'

/** Params rendered bold (objects/rooms etc. — also shown on the board). */
const BOLD_PARAMS = new Set(['object', 'objectNom', 'objectPrep', 'objectGen', 'objectIns', 'objectEvery', 'objects', 'room', 'attribute', 'who', 'whoNeg', 'whoSg', 'whoOther', 'whoOtherPl', 'whoBare', 'mate', 'mateLc', 'row', 'col', 'n', 'line', 'roomRel', 'target', 'people', 'atCell', 'area'])

/**
 * The rich-text machinery shared by suspect clues AND board (global) clues: one place that
 * turns `[[word:tipKey]]` / `{{param}}` templates into bold words with concept tooltips.
 * Board clues used to go through `renderer.render()`, which STRIPS the `[[…]]` markers —
 * so a "[[Personen:person]]" in a global clue silently lost its tooltip (user-reported).
 * `anchor` decides which card the tooltip docks to (`.mk-clue` vs `.mk-boardclue`).
 */
export function makeRichRenderer(
  renderer: Renderer,
  t: (key: string) => string,
  anchor: string,
  onTerm?: (word: ReactNode, tipKey: string) => void,
): (exp: Explanation, extra: Record<string, string | number>) => ReactNode[] {
  const term = (key: number | string, word: ReactNode, tipKey: string): ReactNode => {
    onTerm?.(word, tipKey)
    return (
      <InfoTip key={key} className="mk-term" anchor={anchor} content={t(`tip.${tipKey}`)}>
        <strong>{word}</strong>
      </InfoTip>
    )
  }

  const parseTemplate = (
    tmpl: string,
    params: Record<string, string | number>,
    childNodes?: ReactNode[],
  ): ReactNode[] => {
    const out: ReactNode[] = []
    const re = /\{\{(\w+)\}\}|\[\[([^\]]+?):([^\]]+?)\]\]/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(tmpl)) !== null) {
      if (m.index > last) out.push(tmpl.slice(last, m.index))
      if (m[1]) {
        const name = m[1]
        if (name === 'child' && childNodes) {
          out.push(...childNodes)
        } else {
          const val = renderer.resolveParam(name, Renderer.paramValue(params, name), false, params.subject)
          // The negation word ("nicht"/"not") is bold + tooltipped like the concept
          // words; the trailing space stays outside the bold span so spacing is unchanged.
          if (name === 'neg') {
            const word = String(val).trim()
            if (word) {
              out.push(term(m.index, word, 'negation'))
              out.push(' ')
            }
          } else if (name === 'direction' || name === 'directionComp')
            out.push(term(m.index, val, 'direction'))
          // "demselben Tisch" carries the "same instance" concept — bold + its tooltip,
          // like a concept word (the article is gendered, so it stays a param).
          else if (name === 'objectSame') out.push(term(m.index, val, 'besideSameObject'))
          // Hair-colour traits are tinted in the actual colour ("braune Haare" in brown)
          // so the colour is unmistakable; the token is "hair_<colour>".
          else if (name === 'attribute' && String(params.attribute ?? '').startsWith('hair_')) {
            out.push(
              <strong key={m.index} className={`mk-hair mk-hair--${String(params.attribute).slice(5)}`}>
                {val}
              </strong>,
            )
          }
          // The "someone who had <hair>" mate phrase (roomExists / beside-same-object):
          // rebuild it so only the hair-colour word carries the colour outline.
          else if ((name === 'mate' || name === 'mateLc') && String(params[name] ?? '').startsWith('attr:hair_')) {
            const token = String(params[name]).slice(5) // "hair_<colour>"
            const pre = renderer.lookup('who.withTraitPre') ?? ''
            const post = renderer.lookup('who.withTraitPost') ?? ''
            const word = renderer.lookup(`attr.${token}`) ?? token
            const preText = name === 'mate' && pre ? pre.charAt(0).toUpperCase() + pre.slice(1) : pre
            // "ein anderer Verdächtiger, der" carries the suspect concept → bold + tooltip.
            out.push(term(`${m.index}p`, preText, 'suspect'))
            out.push(' ')
            out.push(
              <strong key={`${m.index}h`} className={`mk-hair mk-hair--${token.slice(5)}`}>
                {word}
              </strong>,
            )
            if (post) out.push(<strong key={`${m.index}s`}> {post}</strong>)
          } else if (name === 'mate' || name === 'mateLc') {
            // The mate of a roomExists / beside-same clue is always a suspect (never the
            // victim). A named person is that specific suspect (just their name); the
            // generic / gender / trait phrasings get the "suspect" concept tooltip.
            const tok = String(params[name] ?? '')
            if (tok.startsWith('person:')) out.push(<strong key={m.index}>{val}</strong>)
            else out.push(term(m.index, val, 'suspect'))
          }
          // Inside/outside is a concept of its own — the outdoor flag is invisible on the
          // board, so the area word ("drinnen"/"draußen") carries its inside/outside tooltip.
          else if (name === 'area') out.push(term(m.index, val, String(params.area)))
          else if (
            name === 'who' ||
            name === 'whoNeg' ||
            name === 'whoSg' ||
            name === 'whoIns' ||
            name === 'whoOther' ||
            name === 'whoOtherPl' ||
            name === 'whoBare'
          ) {
            // "_susp" gender tokens are suspects (victim excluded → "suspect" tooltip);
            // plain gender tokens count everyone incl. the victim → the "all people" one.
            const tok = String(Renderer.paramValue(params, name))
            out.push(term(m.index, val, tok.includes('_susp') ? 'suspect' : 'person'))
          } else if (BOLD_PARAMS.has(name)) out.push(<strong key={m.index}>{val}</strong>)
          else out.push(val)
        }
      } else {
        out.push(term(m.index, m[2], m[3]))
      }
      last = re.lastIndex
    }
    if (last < tmpl.length) out.push(tmpl.slice(last))
    return out
  }

  const renderExp = (exp: Explanation, extra: Record<string, string | number>): ReactNode[] => {
    if (exp.children && exp.children.length > 0) {
      if (exp.key === 'clue.and' || exp.key === 'clue.or') {
        const conn = renderer.lookup(exp.key === 'clue.and' ? 'clue.connAnd' : 'clue.connOr') ?? '&'
        const out: ReactNode[] = []
        exp.children.forEach((c, i) => {
          if (i > 0) out.push(` ${conn} `)
          out.push(...renderExp(c, extra))
        })
        return out
      }
      if (exp.key === 'clue.not') {
        const child = exp.children[0]
        const negWord = renderer.lookup('clue.negWord') ?? 'nicht '
        const isComposite = !!(child.children && child.children.length > 0)
        if (!isComposite) {
          // A dedicated negated wording ("In seinem Raum war keine Frau"): the child's
          // `<key>Neg` template, with any `who` token flipped to its "kein/keine" form.
          const negTmpl = renderer.lookup(`${child.key}Neg`)
          if (negTmpl !== undefined) {
            const params: Record<string, string | number> = { ...extra, ...(child.params ?? {}) }
            if (typeof params.who === 'string') params.whoNeg = renderer.negWhoToken(params.who, params)
            if (typeof params.mate === 'string') params.mateLc = params.mate
            return parseTemplate(negTmpl, params)
          }
          // Inject "nicht " into the child sentence ("X war nicht …") when it has a
          // {{neg}} slot.
          const childTmpl = renderer.lookup(child.key)
          if (childTmpl && childTmpl.includes('{{neg}}')) {
            return renderExp(child, { ...extra, neg: negWord })
          }
        }
        // Fallback: wrap it as "nicht (…)".
        return parseTemplate(
          renderer.lookup('clue.not') ?? 'not ({{child}})',
          extra,
          renderExp(child, extra),
        )
      }
      return exp.children.flatMap((c, i) => (i > 0 ? [' ', ...renderExp(c, extra)] : renderExp(c, extra)))
    }
    const params = { ...extra, ...(exp.params ?? {}) }
    const tmpl = renderer.lookup(renderer.pluralKey(exp.key, params)) ?? exp.key
    return parseTemplate(tmpl, params)
  }

  return renderExp
}

/** One concept term of a clue, for the mobile Akten-Notiz: the exact word as shown in the
 *  sentence plus its tip key. */
export interface ClueTerm {
  word: ReactNode
  tipKey: string
}

/**
 * Collects every concept term the given explanations RENDER as a tooltip word — by running
 * the very same rich walk the clue text uses (one wording source, no drift), just with a
 * collector attached and the produced nodes thrown away. Deduped by tip key: the mobile
 * Akten-Notiz lists each concept once, however often the sentence repeats it.
 */
export function collectClueTerms(
  renderer: Renderer,
  t: (key: string) => string,
  describes: readonly Explanation[],
  subjectId?: PersonId,
): ClueTerm[] {
  const seen = new Set<string>()
  const out: ClueTerm[] = []
  const renderExp = makeRichRenderer(renderer, t, '.mk-clue', (word, tipKey) => {
    if (!seen.has(tipKey)) {
      seen.add(tipKey)
      out.push({ word, tipKey })
    }
  })
  const extra: Record<string, string | number> = subjectId
    ? { name: subjectId, subject: subjectId, poss: subjectId, subjectObj: subjectId }
    : {}
  for (const d of describes) renderExp(d, extra)
  return out
}

