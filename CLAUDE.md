# Murdoku — Regeln & Architektur

Ein Deduktions-Krimi: Verdächtige + Opfer werden per Hinweisen auf einem Raster platziert.

## Stand (gezählt 16.07.2026 — bei Abweichung neu zählen, nicht raten)

- **143 öffentliche Level** (55 hard, 44 medium, 42 easy, 2 Tutorial) + 32 versteckte
  Garand-Level = 175 Dateien in `levels/`. **Öffentliche Zählung IMMER ohne Garand** —
  die sind versteckt und werden in der README nie erwähnt (Nutzer-Regel).
- **14 Themes** (home, manor, grandhotel, precinct, auto-shop, school, hospital, farm,
  supermarkt, camping, castle, pool, zoo, ski) · **74 Objekt-Typen** (28 betretbar).
- **40 Hinweistypen** (inkl. and/or/not) **+ 5 globale** (`BoardClueJson`) ·
  **34 registrierte Techniken** (28 Klassen) in `forward.ts`.
- **6 Sprachen** (de/en/es/pt/fr/ru; pt = **pt-PT** mit „tu", fr mit **„vous"**, ru mit
  **«вы»** — Personennamen bleiben lateinisch) ·
  Brettgrößen **4×4–12×12** (Korpus & Generator; Editor bis 11×11).
- **Level-Titel:** `title` (de) + `titles {de,en,es,pt,fr}`, Krimi-/Christie-Ton, je Sprache
  eigenständig (nie wörtlich), **eindeutig über den GESAMTEN Korpus je Sprache** (vor dem
  Schreiben maschinell prüfen — Kollisionen kamen vor), kein Opfername, Garand-Level tabu.

## Die zwei Kernregeln (NIEMALS vergessen)

Beide werden dem Spieler angezeigt (`i18n/locales/de.json` → `rule.*`):

1. **`rule.oneEachLine` — Jede Person steht in einer eigenen Zeile UND Spalte.**
   Das Opfer zählt mit. Belegt in `SearchSolver.ts` (`forbid[cell]` = ganze Zeile+Spalte, wird beim
   Setzen aus allen anderen Domains entfernt), `SolveContext.place()` und
   `Generator.generateSolution()` (disjunkte row-/col-Shuffles).
2. **`rule.aloneWithVictim` — Der Opferraum enthält genau EINEN Verdächtigen** (= den Mörder).
   Belegt in `SearchSolver.murderAlone()` und `Generator.placeOnBoard()`.

**Alle Level sind volle Permutationen:** `width == height` und `#Verdächtige + 1 == width`
(4×4 … 12×12; geprüft über alle Level in `levels/`). Also hat *jede* Zeile und *jede* Spalte
**genau eine** Person. `SolveContext.fullPermutation` ist real immer `true`.

### Was daraus folgt — vor jedem neuen Hinweistyp prüfen!

Für je zwei Personen gilt `Δrow ≠ 0` **und** `Δcol ≠ 0`. Deshalb sind folgende Hinweise
**unmöglich oder vakuum** — sie dürfen nicht gebaut werden:

- „direkt neben Y" (orthogonal benachbart) — solche Zellen teilen immer Zeile oder Spalte
- „in derselben Zeile/Spalte wie Y"
- „zwischen Y und Z" (auf einer Linie)
- „genau N Personen in Zeile 3" — es ist immer genau 1
- „X ist die nördlichste Person" — ≡ `inRow(0)`, ein verkappter Zeilen-Hinweis
  (Zeilen-Hinweise sind im Generator bewusst gedeckelt: `MAX_LINE_CLUES = 1`)

Was überlebt: **diagonale Berührung** (`|Δrow|=1 && |Δcol|=1` — die einzige mögliche Nachbarschaft),
**Distanz** (Chebyshev ≥ 1), **alles über Räume** (Blobs, keine Linien), **Raum-Nachbarschaft**,
**globale Merkmals-Verteilung**.

### Abgeleitete Feinheiten

- Ein Raum mit dem Opfer hat immer genau 1 Verdächtigen ⇒ **„Raum ohne Verdächtigen" ≡ „Raum ohne
  Person"**. So rechnet `EmptyRoomsTechnique` bereits.
- Opferraum = genau **2 Personen** / **1 Verdächtiger** ⇒ Untergrenzen für Belegungs-Hinweise.
- **Das Opfer zeigt nur sein Geschlecht.** Bart/Brille/Glatze/Haare sind zufällig und verdeckt
  (`Generator.candidatesFor` → `usableTrait`). Ein Hinweis darf nie an einem verdeckten
  Opfer-Merkmal hängen — sonst ist er für den Spieler nicht nachvollziehbar.
- **`outside` ist ein reines Raum-FLAG, das die Grafik nirgends verrät** (die Bodentextur folgt
  dem Raum*namen*). Jeder Hinweis, der drinnen/draußen nutzt, braucht deshalb die Legende
  „Draußen: …" — sonst ist er unlösbar. Steuernd: `clues/clueRefs.ts` → `usesInsideOutside`,
  genutzt von `CluePanel` (Spiel) **und** `SuspectsPanel` (Editor). Beim Hinzufügen eines
  Hinweistyps, der auf dem Flag beruht, dort ergänzen — er muss alle drei Orte abdecken
  (Verdächtigen-Hinweise, `globalClues`, `boardClues`). Achtung: `UniqueOutsideClue` erbt
  **nicht** von `OutsideClue`. Test: `clues/insideOutside.test.ts`.

## Raumstruktur (Messbasis: der Handkorpus von 163 Leveln, Stand der Messung)

Der Generator (`generateRooms`) bildet diese Struktur nach — beim Ändern nicht verletzen:

- **`Räume ≤ Verdächtige` ausnahmslos** (0 von 163 haben mehr). Räume/Verdächtige liegt bei
  0.6–1.0, Ø 0.8; **24 % haben exakt `Räume == Verdächtige`**.
- Nur bei `Räume == Verdächtige` **und** `emptyRooms: 0` greift die Raum-Bijektion
  (`RoomCoverageTechnique`). Beides muss möglich bleiben.
- **60–70 % der Räume sind exakte Rechtecke** (füllen ihre Bounding-Box) → Räume entstehen per
  rekursiver Rechteck-Teilung (BSP), nicht per Flood-Fill; danach werden wenige Zellen an
  Nachbarräume abgegeben (L-Formen), ohne einen Raum zu zerreißen.
- Kleinster Raum: Ø 6–7 Felder (absolutes Minimum 2) → Schnitte werden mittig balanciert, der
  Mindestraum skaliert mit dem Brett (≈45 % der Durchschnittsfläche).
- Ø 2.4–3.0 Nachbarräume pro Raum. Wichtig: bei zu wenigen Räumen grenzt jeder an jeden und
  Nachbarschafts-Hinweise sagen nichts mehr.
- Void-Zellen sind die Ausnahme (2 von 163).

`generateSolution` strebt auf der Hälfte der Level eine Platzierung **ohne leeren Raum** an —
per Zufall entsteht sie fast nie (gemessen 5 %), und ohne sie kann „Kein Raum war leer" nicht
existieren.

## Jeder Hinweis muss gebraucht werden (ab Mittel)

Ein Hinweis, den man weglassen kann und der Fall löst sich trotzdem, ist **Rauschen** — der
Spieler liest ihn, rechnet mit ihm, und er war Deko. Gemessen vor der Sperre: **15–20 % aller
Hinweise** waren entbehrlich — in generierten *und* handgebauten Leveln gleichermaßen.

- `Generator.hasRedundantClue(level)` lässt jeden Hinweisteil einzeln weg und prüft, ob das
  Level noch **vorwärts** lösbar ist (nur Vorwärts-Löser, keine Eindeutigkeitssuche — löst es
  vorwärts, war der Hinweis nicht nötig). Hängt als **harte Akzeptanzbedingung** in
  `pickBestLevel` → deckt freie Generierung **und** den Editor-Fill ab.
- **Easy ist ausgenommen.** Dort laufen die „Vorgaben" absichtlich als Mitläufer mit: ein
  relationaler Hinweis hat kein Zellfeld, kann also nicht fixieren, und ihn tragend zu machen
  hieße Rang 3 — dann wäre es kein leichtes Level mehr.
- **Ein entbehrlicher Hinweis lässt sich nicht durch einen besseren ersetzen.** Löst der Fall
  ohne X' Hinweis, ist *jeder* Hinweis für X entbehrlich — das Level ist durch die ÜBRIGEN
  überbestimmt. Nur ein anderer Kandidat hilft. Deshalb ein Tor, keine Reparatur.
  Gemessen: **90 % der abgelehnten Kandidaten** sind genau dieser Fall (Einzelhinweis entbehrlich),
  nur 1 % ein entbehrlicher UND-*Teil* — den kürzt Phase 2a der Konstruktion längst weg. Ein
  „Teile kürzen statt verwerfen" bringt also nichts (Tor-Durchsatz 8 % → 10 %).
- Das Tor ist damit **die Härte-Anforderung selbst**, kein Performance-Hindernis: Bei einer vollen
  Permutation ist die letzte Person durch Ausschluss erzwungen, ihr Hinweis wäre Deko. Ein Hinweis
  für X ist nur tragend, wenn er hilft, jemand **anderen** zu platzieren — genau das verzahnte,
  breite Level, das „hard" ausmacht.
- `pruneClues` findet dadurch bei Verdächtigen-Hinweisen nichts mehr zu kürzen (es kürzt nur,
  solange lösbar — genau das schließt das Tor aus). Das ist stimmig; Board-Clues kürzt es weiter.
- Jeder Verdächtige behält **mindestens einen** Hinweis (0 von 1090 im Handkorpus sind ohne).

## Generator-Fallstrick: Invariante ≠ Wächter (teuer gelernt)

`constructLogicClues` baut **inkrementell**. Jede Prüfung dort muss den **Zuwachs** beurteilen
(„macht meine Änderung es schlimmer?"), **nie den Zustand** („ist das Level makellos?").

Warum das keine Stilfrage ist: Die Verdächtigen starten auf je einem Hinweis, und breite Hinweise
sehen über Personen hinweg identisch aus („nicht neben einem Spind") — **96 % der 9×9-hard-Bretter
tragen schon beim Start ein Duplikat**. Ein Wächter, der `duplicateClueCount(...) === 0` verlangt,
ist dann `false`, **egal was hinzugefügt wird**: Er lehnt jeden Kandidaten ab, `addPart` gibt auf,
der Versuch stirbt — gemessen **100 %** aller Abbrüche, mit ~2170 unbenutzten Hinweisen im Vorrat.
`addPart` ist nie wirklich aus Hinweisen ausgegangen.

Muster (Phase 4 machte es immer richtig, die anderen drei waren daran vorbeigebaut):

```ts
const dupBefore = dupCount()          // VOR der Änderung merken
...
if (dupCount() > dupBefore) reject    // nur der Zuwachs zählt
```

Gleiches gilt für `capOverflow()` (Familien-Deckel): Die Deckel-Reparatur lief, *weil* ein Deckel
verletzt war — und verwarf dann jeden Tausch, der nicht in EINEM Schritt vollständig heilte. Sie
konnte den ersten von zwei nötigen Schritten nie gehen (63 % aller Versuche, nachdem der
Dedup-Deadlock sie nicht mehr verdeckte). Sie muss **Fortschritt** annehmen, nicht Perfektion.

Die Auslieferungs-Garantie hängt **nicht** an diesen Wächtern: Phase 3/4 räumen auf, und
`pruneClues` + `pickBestLevel` liefern kein Level mit Duplikat oder über Deckel aus.

**Kosten der Wächter (`rate()` = eine volle Deduktion über das ganze Level):** immer erst die
billigen, rein bucheinsichtigen Prüfungen, dann `rate()`. Und in 2a-hard deckelt `HARD_SCAN` die
Probier-Tiefe — **gleichmäßig über die nach Breite sortierte Liste gestreut, nie als Kopf-Deckel**:
Breite Hinweise machen das Level viel öfter unlösbar, ein Kopf-Deckel probiert also genau die
Verlierer und kostete gemessen **60 % aller harten Hinweise**. Gestreut kostet er **nichts** — der
billigere Versuch kauft mehr Versuche, und `pickBestLevel` macht daraus wieder Qualität.

## Was „hart" heißt (Nutzer-Definition, wörtlich)

> „ein hartes Level macht nicht aus, dass wir harte Hinweise nutzen, sondern es ist der Mix aus
> logischen Ketten, spätem Setzen von Eindeutigkeiten von Verdächtigen, viele wenn dann dann,
> eine gute Ausdehnung dass der Anfang für den Menschen nicht so einfach ist"

**Referenzlevel: `levels/museum.json`** — das einzige vom Nutzer benannte Beispiel für „logisch, aber
echt hart". Seine Zahlen sind der Maßstab, **nicht** der Durchschnitt des Handkorpus (der ist
größtenteils vom Editor-Fill erzeugt — sich daran zu messen ist zirkulär):

| | museum | Bedeutung |
|---|---|---|
| Ausdehnung (`constrainedRatio`) | **98 %** | wie viel Brett nach dem Lesen ALLER Hinweise offen bleibt |
| Breite (`avgBreadth`) | 38 % | und das über VIELE Verdächtige, nicht einen |
| 1. Setzung (`openingSteps`) | **Schritt 24** | wie lange das Brett standhält, bevor jemand feststeht |
| harte Hinweisarten | 1 von 8 | ⇒ Breite geht AUCH ohne viele davon |

**Breite ist das ZIEL, die Hinweisart ein MITTEL** — und zwar ein gutes: harte (relationale) Hinweise
sind von Natur aus breit, „je mehr harte und je mehr Breite super". Nutzer wörtlich: „ein hartes
Level ist schon sehr breit, ich sagte nur es muss **nicht nur** Level 5 harte Hinweise sein. Wenn es
breit wird durch andere Hinweistypen, dann gerne, siehe Museum. Aber ich habe nichts gegen viele
harte Hinweise." Also: `hardClueCount` bleibt im Score, Rang 5 ist **kein Ziel** (nur Boden), und
Breite/Ausdehnung/Ketten/spätes Setzen entscheiden.

Bars des Nutzers: `HARD_COVERAGE_BAR = 75`, `HARD_BREADTH_BAR = 50` — harte Hürde **mit
Auffangnetz** (nichts gefunden ⇒ bestes Vorhandenes, nie „kein Level"). Sie galten einmal als
unerreichbar und wurden gestrichen; der verwaiste Doc-Kommentar über `breadthPenalty` ist ihr
Grabstein. Unerreichbar waren sie wegen der Bugs unten, nicht wegen der Zahlen.

**Etikett = Definition (16.07.2026, Nutzer-OK):** `tierFor` vergibt „hard" auf drei Wegen — viele
harte Hinweisarten (alt), Rang 5 (alt), **oder Bars geschafft + Rang ≥ 4** (die Nutzer-Definition).
Ohne den dritten Weg hießen die besten Pool-Picks (95–100 % Ausdehnung) „medium": gemessen 7 von 8.
Gespeicherte Level behalten ihr Etikett; nur frisch Bewertetes nutzt die neue Regel.

**Fallen dabei:**
- **Breite und Ausdehnung sind Gegenspieler**, wenn man stumpf auf Breite optimiert: Der
  breiteste Hinweis ist ein relationaler (ganzes Brett offen) — und der zählt bei der Ausdehnung
  **gar nicht mit** (`restricted = domain.size < total`). Auf Breite optimieren schob 6 von 8
  Verdächtigen auf relationale Hinweise: Breite 75 %, Ausdehnung **4 %**. Regel: so breit wie
  möglich, **ohne aufzuhören, etwas über Zellen zu sagen** (`broadestIdx` kennt sie).
- **`openingSteps` hängt daran, dass NUR `NakedSingleTechnique` `placedCell` setzt.** Eine zweite
  setzende Technik macht die Kennzahl (und `stuck`) still falsch.
- Absolute Schrittzahl nehmen, nicht den Anteil an der Kette: easy-Level sind nur 13–17 Schritte
  lang, der Anteil schmeichelt ihnen (easy 31–50 %, generiert „hart" 21–27 %).

## Generator-Fallstricke (teuer gelernt)

**1. Invariante ≠ Wächter.** `constructLogicClues` baut **inkrementell**. Jede Prüfung dort muss den
**Zuwachs** beurteilen („macht meine Änderung es schlimmer?"), **nie den Zustand** („ist das Level
makellos?"). Die Verdächtigen starten auf je einem Hinweis, und breite Hinweise wiederholen sich
über Personen — **96 % der 9×9-hard-Bretter tragen schon beim Start ein Duplikat**. Ein Wächter,
der `duplicateClueCount(...) === 0` verlangt, ist dann `false`, **egal was hinzugefügt wird**:
Er lehnt jeden Kandidaten ab, `addPart` gibt auf, der Versuch stirbt — gemessen **100 %** aller
Abbrüche, mit ~2170 unbenutzten Hinweisen im Vorrat. `addPart` ging nie wirklich aus.

```ts
const dupBefore = dupCount()          // VOR der Änderung merken
if (dupCount() > dupBefore) reject    // nur der Zuwachs zählt
```

Gleiches für `capOverflow()`: Die Deckel-Reparatur lief, *weil* ein Deckel verletzt war — und
verwarf jeden Tausch, der nicht in EINEM Schritt vollständig heilte (63 % aller Versuche). Sie muss
**Fortschritt** annehmen, nicht Perfektion. Phase 4 machte es immer richtig; die anderen drei waren
daran vorbeigebaut. Die Auslieferungs-Garantie hängt **nicht** an diesen Wächtern, sondern an
Phase 3/4 + `pruneClues` + `pickBestLevel`.

**2. `tightness` ist KEINE Breite.** Es liefert für zellbasierte Hinweise die echte Zellenzahl, für
alle anderen handverlesene **Vorlieben**-Konstanten (`inRow → 150` = „letzte Wahl", obwohl eine
Zeile nur 9 von 56 Zellen trifft; `direction → 100`, obwohl das ganze Brett offen bleibt). Wer über
breit/eng redet, muss `candidateCells(board).size` nehmen — sonst „weitet" man einen 56-Zellen-
Hinweis auf 9 Zellen auf (gemessen: Ø **−17** Zellen, 42 % aller „Erfolge" verengten).

**3. Kosten der Wächter:** `rate()` = eine volle Deduktion über das ganze Level. Immer erst die
billigen, rein bucheinsichtigen Prüfungen, dann `rate()`. `HARD_SCAN` deckelt die Probier-Tiefe in
2a-hard — **gleichmäßig über die breiten-sortierte Liste gestreut, nie als Kopf-Deckel**: Breite
Hinweise machen das Level viel öfter unlösbar, ein Kopf-Deckel probiert genau die Verlierer und
kostete **60 % aller harten Hinweise**. Gestreut kostet er nichts — der billigere Versuch kauft mehr
Versuche, und `pickBestLevel` macht daraus wieder Qualität.

**4. Konstanten brechen, ohne dass jemand sie anfasst.** `FALLBACK_BUDGET` (Hauptthread, 8 s hart)
war für Versuche à 140 ms bemessen. Nachdem der Dedup-Deadlock weg war, kosteten Versuche 1,1 s —
dieselben 8 s kauften 7 statt 57 Versuche, und 9×9 hard scheiterte 3 von 8 Mal („kein Level
gefunden"). **Beide Budgets messen** (`generatorClient.ts`: `WORKER_BUDGET` **und**
`fallbackBudget()`), nicht nur das Worker-Budget.

**5. Performance-Verträge (16.07.2026, alle per Fest-Seed-Fingerprint verlustfrei bewiesen):**
- `Clue.candidateCells` ist in der **Basisklasse memoisiert** (pro Board-Identität); Subklassen
  implementieren `computeCandidateCells`. Die Sets werden zwischen Solves GETEILT — **Aufrufer
  dürfen sie nie mutieren** (Komposits kopieren vor dem Schneiden; so lassen).
- `constructLogicClues.rate()` baut das Puzzle **direkt** aus gecachten Teilen (ein Board, gecachte
  Clue-Instanzen) statt über LevelJson→`loadLevel` — nur so wird der candidateCells-Memo über die
  ~370 Deduktionen pro Versuch warm. Wer rate() anfasst: Instanz-Caches (`leafInstAt`/`clueInstOf`)
  nicht umgehen.
- `NakedGroupTechnique` nutzt Bitmasken + lexikografische DFS mit Schranken-Pruning,
  `ForcedCellTechnique` einen Ein-Pass-Scan — beide müssen **identische Eliminierungen in
  identischer Reihenfolge** liefern wie die naive Form (die DFS-Besuchsreihenfolge = alte
  `combinations()`-Reihenfolge ist der Beweis-Anker).
- Ein **Rating-Memo** über den `used`-Zustand wurde gebaut, gemessen (Trefferquote 0,5–1 %) und
  **verworfen** — die Pässe besuchen fast nie denselben Zustand zweimal. Nicht wieder bauen.
- **Wanduhr-Messungen rauschen ±20 %** auf dieser Maschine (identische Arbeit: 11,8–14,1 s).
  Vergleiche nur mit festen Seeds, verschränkt im selben Prozess, mehrfach wiederholt — und
  Verlustfreiheit IMMER mit versuchs-gebundenem Budget fingerprinten (zeit-gebunden schafft
  schnellerer Code mehr Versuche ⇒ anderes Level ⇒ sieht fälschlich wie ein Bug aus).

## Worker-Pool (`generatorClient.ts`)

Die Generierung läuft in einem **Pool paralleler Worker** (`poolSize() = min(4, Kerne−1)`), jeder
mit disjunktem Seed-Strom; der Hauptthread wählt den Sieger per `selectBestLevel` — **derselben
Skala**, mit der jeder Worker seine Kandidaten bewertet hat (Test: `generator/selection.test.ts`,
museum muss Der_Burgfall schlagen). Level-Qualität skaliert direkt mit der Kandidatenzahl
(gemessen: 1 Kandidat ⇒ Hürden sind Glückssache, 4+ ⇒ Normalfall). 2-Kern-Gerät ⇒ Pool = 1 =
altes Verhalten, **mobil nie schlechter**. Fehlerleiter: toter Worker verkleinert den Pool; ALLE
tot ⇒ ein Inline-Fallback (nie N parallele Hauptthread-Läufe — die frören die UI N-fach ein).
`quality: 'fast' | 'max'` ist der vorverdrahtete UI-Regler (softMs 2500/8000).

## Clue-API (`engine/clues/Clue.ts`)

| Hook | Wer nutzt es | Regel |
|---|---|---|
| `candidateCells(board)` | `DeductionEngine.seedDomains`, `SearchSolver` | **MUSS Obermenge der wahren Zellen sein.** Zu enge Menge ⇒ mehrdeutiges Level gilt als eindeutig. `null` = rein relational |
| `definiteCells(board)` | **nur** `NotClue.candidateCells` | Zellen, wo der Hinweis *garantiert* gilt (unabhängig von anderen). `null` ⇒ Negation prunt nichts und muss in einer Technique stehen |
| `forbiddenForOthers(board)` | **nur** `UniqueConstraintTechnique` | feste Zellmenge, die für alle anderen entfällt |
| `violatedBy(subj, placement, puzzle)` | `SearchSolver` + `narrow()`, `DeductionEngine.removableReason` | Pruning bei Teilbelegung, nie false-positive |
| `test(subj, solution, puzzle)` | Endvalidierung | Wahrheit auf der Vollbelegung |

Board-Clues (global, `clues/boardClues.ts`) haben nur `test` + eine eigene Technique.

Vollständiges Inventar (nie hier duplizieren, sonst veraltet es): `ClueJson` in
`clues/ClueFactory.ts`, `BoardClueJson` in `io/LevelSchema.ts`.

## Persistierte Daten überleben Refactorings (teuer gelernt)

localStorage-**Entwurf**, gespeicherte **Custom-Level** und **Exporte** enthalten JSON, das ein
ÄLTERER Build geschrieben hat. Wer einen `type` umbenennt oder entfernt, **muss** die Migration
mitliefern — sonst öffnet sich der Editor nie wieder.

- `createBoardClue` / `createClue` **werfen** bei unbekanntem Typ. Das ist Absicht: früher fiel
  der `switch` durch und lieferte `undefined`, was erst weit entfernt als
  „Cannot read properties of undefined (reading 'describe')" auftauchte.
- Migration: `game/editorModel.ts` → `normalizeBoardClue` / `normalizeBoardClues`. Legacy-Formen
  werden umgeschrieben, wirklich Unbekanntes verworfen (ein verworfener Hinweis ist besser als
  ein dauerhaft toter Editor).
- Sie ist an **allen drei** Eintrittspunkten verdrahtet: `storage.loadCustomLevels()`,
  `EditorScreen.migrateDraft()` (localStorage-Entwurf) und `editorModel.editorStateFromLevel()`.
- Test: `game/boardClueMigration.test.ts` — bei jedem Umbenennen dort einen Fall ergänzen.

## Deduktion

`DeductionEngine` löst **rein vorwärts** — kein Raten. Techniques in `solver/techniques/`,
registriert in `solver/forward.ts`, Rang in `solver/DeductionStep.ts` (`TECHNIQUE_RANK`).
Der Generator akzeptiert nur Level, die die Engine *ohne* Fallunterscheidung löst — das garantiert
zugleich Eindeutigkeit **und** Menschen-Lösbarkeit.

Nützliche Helfer in `SolveContext`: `roomsCapacity(rooms)` (min. Zeilen/Spalten-Spanne = Obergrenze
für Personen), `fullLinesIn(room, axis)`, `guaranteedRoomOf(id)`, `roomsOf(id)`, `linesOf(id, axis)`.

## Checkliste: neuer Hinweistyp

1. `engine/model/Board.ts` — Geometrie-Helfer (memoisiert)
2. `engine/clues/*.ts` — Clue-Klasse
3. `engine/clues/index.ts` + `ClueFactory.ts` — Export, `ClueJson`, `createClue`
4. `engine/clues/clueRefs.ts` — falls der Hinweis Personen/Merkmale nennt
5. `engine/solver/` — Technique + `forward.ts` + `Technique`-Name/`TECHNIQUE_RANK`;
   relationale Typen zusätzlich in `SearchSolver.relationalLinks`
6. `engine/generator/Generator.ts` — `candidatesFor` emittiert ihn; ggf. `HARD_CLUE_TYPES`,
   `UNCAPPED_TYPES`, `cappedFamilies`; `collapsesToLine`-Guard
7. `game/editorClues.ts` — `CondKind`/`roomMode` + **verlustfreier Round-Trip**
8. `components/ClueBuilder.tsx` — UI (mobil mitdenken)
9. **`i18n/Renderer.ts` UND `components/clueRich.tsx`** — Wording/Negation immer in *beiden*;
   `<key>Neg` für negierte Sonderformen, `BOLD_PARAMS` in clueRich. Die Rich-Maschinerie
   (`makeRichRenderer`) ist EINE Quelle für Verdächtigen-Hinweise (`ClueText`), globale
   Hinweise (`BoardClueText` — laufen NICHT über `renderer.render`, das würde `[[…]]`
   verschlucken!) und die Akten-Notiz (`collectClueTerms`)
10. `i18n/locales/{de,en,es,pt,fr}.json` — **alle fünf** Sprachen, `_one`/`_zero` bei `{{count}}`.
    ACHTUNG fr: Templates haben KEINEN `{{neg}}`-Slot — jede negierbare Aussage braucht ein
    eigenes `<key>Neg`-Template („ne … pas"), sonst fällt die Negation auf den hässlichen
    „pas (…)"-Wrapper zurück. Objekt-Slots in fr: „d'{{object}}" (alle Tokens beginnen mit
    un/une), „qu'{{objectNom}}"; pt nutzt `{{neg}}` = „não " wie es.
11. `game/helpMarks.ts` — Kommissar-Modus: nur gestrichelt umranden, nie Flächen füllen
12. Beim UMBENENNEN/ENTFERNEN eines Typs: Migration in `editorModel.normalizeBoardClue` (s.o.)

**Pflicht-Prüfungen** (alle grün, bevor etwas als fertig gilt):

```
npx tsc -b && npx vitest run && npx eslint .
npx tsx src/dev/check-all.ts ""        # ALLE Level eineindeutig (aktuell 175 Dateien)
npx tsx src/dev/soundness-check.ts     # keine Technique streicht je eine wahre Zelle
```

Dazu je neuem Typ: `candidateCells` ⊇ `{Zellen, wo test() wahr ist}` per Brute-Force
(`clues/roomAdjacency.test.ts` als Muster) und ein End-to-End-Fall in
`solver/newClueTechniques.test.ts` (wahren Hinweis an echte Bretter hängen → Level bleibt
eindeutig **und** die Deduktion streicht nie eine wahre Zelle).

**Messen, nicht raten:** Ein Test, der grün ist, weil die Technique nie feuert, beweist nichts —
`techniqueCounts` gegenprüfen. Und Texte immer einmal wirklich rendern lassen.

Bekannt & nicht deine Schuld: `79_Der_Bauernhof.json` löst als einziges Level nicht rein
vorwärts (braucht eine Fallunterscheidung) — alle anderen Level tun es.

## Userlevel (Community-System, 08/2026)

Spieler laden Editor-Level zu einer PHP-API hoch (`php/` → Deploy `https://apo-games.de/murdoku/`;
Tabellen in `php/schema.sql`: `murdoku_userlevel` + Drossel `murdoku_upload_ip`). Client-Logik in
`src/game/userlevels.ts` (Sync-Cache in localStorage, offline voll spielbar), Screen
`UserLevelScreen`, Level-ids `ul-<dbId>`.

- **Upload ist ASYNCHRON und schnell** (<1 s, KEINE OpenAI-Aufrufe im Pfad — Dirks Regel: niemand
  wartet): `addUserlevel.php` speichert `status='pending'`; `processUserlevel.php` (vom Client
  fire-and-forget angestoßen, `kickProcessing()`) moderiert (omni-moderation; sexual/hate/…
  blocken, violence NICHT — Krimi! API down ⇒ bleibt pending, fail-closed) und übersetzt den
  Titel in alle 6 Sprachen / transliteriert nicht-lateinische Namen (`OPENAI_MODEL`, best effort)
  → `ok`/`rejected`. `sync.php` liefert NUR `ok`; Cursor = `updated` — wird NUR bei der Freigabe
  gebumpt, NIE durch Bewertungen (sonst liefert jeder Sync frisch bewertete Level komplett neu);
  der Client ERSETZT gelieferte Einträge idempotent (so kommen Nachübersetzungen an).
- **Duplikat-Schutz:** `src/game/levelHash.ts` = SHA-256 der KANONISIERTEN Puzzle-Kernstruktur.
  Flavor zählt nicht: Titel/Autor/Namen/Raumnamen/Farben/**Theme**, Raum-BUCHSTABEN (kanonisch
  nach erster Zelle relabelt, `inRoom`-Refs remappt), `outside`-Flags NUR wenn ein Hinweis
  drinnen/draußen nutzt, Personen-Attribute NUR wenn ein Hinweis den Key referenziert (Opfer:
  höchstens `gender` — Rest ist verdeckter Zufall), plus Schreibweisen-Normalisierung (leere
  Layer, ausgeschriebene Defaults, `excludeSelf`, Fenster/Tür-Kanten zweiseitig) ⇒ Editor-
  Roundtrip mit Themewechsel bleibt Duplikat (E2E gemessen: 170/175; die 5 Abweichler nutzen
  drinnen/draußen — dort ändert das Theme das Puzzle wirklich). Vor dem Upload prüft der
  CLIENT lokal (offizielle Level + Sync-Cache, `isDuplicateLocally`), der Server danach per
  String-Vergleich als zweites Netz. **Bei neuen offiziellen Leveln PFLICHT:**
  `npx tsx src/dev/userlevel-hashes.ts` laufen lassen und `php/internal_hashes.php` neu
  deployen — sonst lassen sich offizielle Level als Userlevel hochladen.
- **ratings-Zeilen sind positionscodiert:** Spaltenreihenfolge `TAG_KEYS` (php/db_config.php)
  == `USERLEVEL_TAGS` (userlevels.ts). Beim Ändern IMMER beide synchron halten.
- **Auto-Tag „Ausprobieren"** (`nologic`): Level eindeutig, aber die Default-Deduktions-Pipeline
  scheitert (⇒ Tipp funktioniert dort nicht). Wird NICHT in der DB gespeichert, sondern von jedem
  Client beim Sync selbst berechnet — lernt die Engine Techniken dazu, verschwindet der Tag mit
  dem App-Update (Re-Check markierter Level, wenn die `TECHNIQUE_RANK`-Größe sich ändert).
  Upload-Gate im Editor: `checkLevel` 'ok' ODER 'contradiction'; mehrdeutig/unlösbar = gesperrt.
- **Bewerten nur online** und einmalig pro Level (`murdoku.userlevels.rated.v1`); Sperre und
  lokale Einrechnung erst NACH Server-OK — keine Offline-Queue (bewusst entfernt). Autor ist
  beim Upload optional. Rate-Limit: 1 Upload / 5 s je IP (gespeichert nur als SHA-256-Hash).
- `php/db_config.php` ist **gitignored** (echte DB-/OpenAI-Secrets; Repo-Vorlage
  `db_config.example.php`). `DEBUG=true` schreibt echte PDO-Meldungen in die Antworten —
  nur zum Einrichten, danach wieder aus. Auswertung: `php/index.php` (Noir-Stil, Status-Spalte).
- **`last_stars`/`last_rated`** (Spalten seit 08/2026, NUR Auswertung): jede Bewertung
  schreibt Wert + Zeitpunkt der letzten Bewertung — der Sync-Cursor `updated` bleibt
  dabei UNBERÜHRT, und das API von `rateUserlevel.php` ist unverändert (alte
  App-Versionen bewerten weiter). `index.php` zeigt daraus „Zuletzt bewertet (Top 5)"
  und das Datum in der Bewertungen-Kachel.
- Sieg-Dialog: die „Community-Wertung"-Zeile übernimmt die EIGENE Bewertung sofort nach
  Server-OK (Ø + Anzahl frisch aus dem eben aktualisierten Cache); Tags/nologic bleiben
  bewusst eingefroren — sonst könnte die Zeile umbrechen (Dialoghöhen-Regel).
- Screen: Sync-/Offline-Status (`mk-ul-status`) ist ein absolut positioniertes
  Overlay-Chip zentriert unter dem sticky Kopf — nimmt keinen Platz im Fluss ein,
  erscheint/verschwindet also ohne Layout-Sprung. Anzahl der gelisteten Fälle über den
  Karten via `select.cases` (`mk-divider__count`, wie die Levelauswahl-Gruppen).

## PDF-Druckbogen & Autoren-Werkzeuge (08/2026)

`src/game/pdfExport.ts`: A4-Bogen **immer quer** (Kopf: Titel/Autor/Stufe + „Offener
Fall"-Stempel; links die Verdächtigen, rechts Brett · Objekt-Legende · SW-Skizze ·
„Der Mörder ist …"-Feld), gerendert als 300-dpi-Canvas → PNG in jsPDF. Vorschalt-Dialog
`PdfDialog` (Share-Sheet-Muster): ohne oder mit **Blatt 2 „Auflösung"** (nummeriertes
Deduktions-Protokoll + gelöstes Brett + Mörder-Karte; nur wenn ein reiner Vorwärts-Weg
existiert — `hasSolutionSheet`, sonst Zeile gesperrt mit Grund). So tragen alle
Texte die Spiel-Schriften inkl. Kyrillisch-Fallback ohne TTF-Einbettung. **jsPDF nur
dynamisch importieren** (~120 KB gehören nicht ins Start-Bundle). Android teilt wie der
JSON-Export (Filesystem base64 OHNE `encoding` + Share-Sheet); komplett offline-fähig.

- **Brett über das ECHTE `drawBoard`** (voller Pfad — `preview: true` ließe die
  Bodentexturen weg); vorher `document.fonts.ready` UND `onArtReady` abwarten.
  **IMMER das leere Brett**: das Opfer wird mitgerätselt (`autoPlaceVictim`), es gibt
  KEIN Opfer-Token — das Opfer ist die letzte Personen-Karte (☠, „war allein mit dem
  Mörder"). Verdächtigen-Karten mit Spielfarben-Falz + `avatarDataUri`-Köpfen, ab 7
  Personen zweispaltig, Schrift-Stufen-Fit 42→18 px (EINE Seite, immer).
- Papier braucht, was im Spiel Tooltip/Legende ist: Objekt-Legende (`drawObjectIcon`),
  beide Grundregeln, „Draußen: …" bei `usesInsideOutside`. Hinweistexte = exakt die
  ClueText-Logik über `renderer.render` (Pronomen-Form, ' · '-Join, Großanfang,
  Schlusspunkt nur wenn nötig); Akten-Notizen wie `CluePanel.boardNotes`.
- **SW-Skizze** (Lösefläche im Murdle-Buch-Stil): hell = begehbar, dunkel = blockiert,
  dicke Wände an Raumgrenzen. Begehbare **top**-Objekte massiv umrandet; **ground**-
  Beläge (Teppich/Weg/Straße) GESTRICHELT und dem exakten Zellmengen-Umriss folgend
  (`strokeAreaOutline`, Endpunkt-Regel: konvex einrücken / gerade durchlaufen / konkav
  überstehen). Verschmolzen wird NUR nach **`MERGE_INSTANCE_TYPES`** + gleicher Raum
  (Board-Instanz-Semantik, aus engine/index exportiert) — zwei Stühle nebeneinander
  sind IMMER zwei Umrisse, nie einer.
- **Kein Einfrieren beim Export:** PNG-Encoding + jsPDF-Zusammenbau laufen in
  `pdf.worker.ts` (Seiten als ImageBitmap-Transfer hinein, PDF als ArrayBuffer zurück;
  Inline-Fallback, wenn Worker/OffscreenCanvas fehlen). Das ZEICHNEN bleibt im
  Hauptthread (braucht DOM-Fonts + Board-Art), mit Doppel-rAF-Yields (`nextPaint`)
  davor/dazwischen. Der `PdfDialog` bleibt währenddessen OFFEN und eingefroren
  (Dialoghöhen-Regel): gewählte Zeile = `mk-saverow--busy` + Spinner +
  `game.pdfCreating`; Abbrechen/Overlay/Back gesperrt, Fehler ⇒ zurück auf idle.
  Vites iife-Worker-Build inlined jsPDF in den Worker-Chunk (~800 KB, lädt erst beim
  Export) — `worker.format` NICHT auf 'es' stellen (beträfe auch den generator.worker).
- Einstieg: Desktop im GameScreen-Kopf (`mk-game__edit--pdf`, im portrait/≤860px-Block
  ausgeblendet); **alle Kopf-Knöpfe haben FESTE 38 px** — der Inhalt (Glyphe vs. SVG)
  darf nie die Höhe diktieren. Mobil als `mk-saverow`-Zeile unten im ?-Legenden-Sheet
  (der Kopf hat dort keinen Platz). Im Editor-Speichern-Dialog als Ecken-Icon oben rechts.
- **Autoren-Werkzeuge** (nur Dirk): 5× aufs MURDOKU-Wortzeichen im StartScreen tippen
  (Toggle, `murdoku.authortools.v1`, `loadAuthorTools()` in storage.ts; Bestätigung
  schwebt absolut). Erst dann erscheint das `{ }`-JSON-Ecken-Icon — Sieg-Dialog UND
  Editor-Speichern jeweils oben LINKS (rechts wohnen Solo-Medaille bzw. PDF). Sichtbare
  „Als JSON"-Zeilen gibt es NICHT mehr (seit den Userleveln braucht sie niemand);
  GameScreen-`onExport` behält bei leerem Namen den Originaltitel.

## UI-Regeln (Dirk, gelten immer)

- **Settings-Dialog darf nie scrollen** — kompakte Zeilen; Mehrfach-Optionen als Dropdown
  (`mk-settings__select`), nie als Chip-Gruppen.
- **Android-Tastatur:** das fokussierte Textfeld muss sichtbar bleiben. Drei Schichten:
  Manifest `windowSoftInputMode="adjustResize"` + Viewport `interactive-widget=resizes-content`
  + `keepFieldVisible()` (`game/keyboard.ts`) als onFocus an Dialog-Inputs.
- **Kein Tap-Highlight:** global `-webkit-tap-highlight-color: transparent` (Androids blauer
  Tap-Schleier passt nie zum Noir-Look; alle Controls haben eigene Press-Zustände).
- **Dialoge springen nicht:** Nach einer Aktion (z. B. Bewertung senden) Inhalte EINFRIEREN
  statt austauschen — die Dialoghöhe darf sich nicht ändern (der Button wird zur Bestätigung).
- **Blockierte Felder** (`blockedStyle`-Setting: Karte/dim/hatch/beides, Default Karte): dim lebt
  im gecachten Floor-Layer, hatch im gecachten Möbel-Layer — die Cache-Schlüssel (`floorSig`/
  `furnitureSig`) kennen den Stil; einmal gerendert, pro Frame nur Blit. Legende bleibt neutral.
  Der `BlockedStyle`-Typ lebt in `boardRender.ts`; `settings.ts` importiert ihn type-only —
  nie andersherum (kein React in boardRender, die Dev-Sheet-Scripts importieren es headless).
- **Speichern = überall das Share-Sheet-Muster** (`mk-saverow`: Icon + Name +
  3–5-Wörter-Unterzeile; gesperrtes Hochladen zeigt den GRUND als Unterzeile), darunter
  abgesetzt „Abbrechen". Editor: Hochladen + Behalten; Generator-Sieg: Behalten (Name-Feld
  darüber, nach dem Behalten wird die UNTERZEILE zur Bestätigung — Zeilengröße bleibt).
  „Als JSON" ist KEINE sichtbare Zeile mehr (→ Autoren-Werkzeuge). Keine
  Hinweistext-Absätze, kein ⓘ.

## i18n-Konventionen

- **`Renderer.lookup` läuft den Key-Pfad VERSCHACHTELT ab.** Ein flacher Key
  `"roomOccupancy.atLeast"` innerhalb von `boardClue` wird **nicht** gefunden — es muss ein
  echtes verschachteltes Objekt sein. Bei einem Miss wirft der Renderer **nicht**, sondern gibt
  den rohen Key aus („boardClue.roomOccupancy.atLeast" landet im Hinweistext).
  Absicherung: `i18n/renderAll.test.ts` rendert **jeden** Hinweis **jedes** Levels in **allen**
  Sprachen und schlägt bei rohem Key oder ungefülltem `{{slot}}` fehl.
- Die Locale-Dateien sind **CRLF** + 2 Spaces, und de/en enthalten 6 handformatierte
  **inline-Objekte** — nie per `JSON.stringify` neu schreiben (das formatiert sie um), sondern
  gezielt an Ankern einfügen.
- Raumnamen sind **artikellose Nomen** („Küche") → Apposition nutzen: `„im Raum {{room}}"`
- `poss` ist im Deutschen **Dativ** („seinem"/„ihrem") — passt zu „in {{poss}} Raum"
- `dir` in es/pt/fr enthält die Präposition schon („al sur"/„a sul"/„au sud")
- `everyWord` (pt „cada", fr „chaque") steuert die `objectEvery`-Ableitung in `Renderer.ts` —
  ersetzt den unbestimmten Artikel des `object.*`-Tokens; de/en/es laufen ohne den Key über
  die alte Replace-Kette (fr darf NIE über die Kette laufen: „un" würde zur es-Regel „cada")
- fr: „allein" IMMER invariabel formulieren („la seule personne …", „avait pour seule
  compagnie …") — „seul/seule" müsste sich nach dem Subjekt richten; pt nutzt dafür „a sós"
- `[[Wort:tipKey]]` = fettes Wort mit Begriffs-Tooltip (`tip.*`)
- `{{neg}}` = Einschub-Slot für „nicht"; wo das grammatisch nicht trägt: eigenes `<key>Neg`-Template
- `pluralKey` wählt `<key>_one` bei 1 und `<key>_zero` bei 0 — „Genau 0 Räume sind leer" wird so
  zu „Kein Raum war leer."
- Texte sind **kontextgerecht**, nie wörtlich übersetzt

## Nicht tun

- Keine Server/Headless-Browser/Screenshots/Prozess-Kills starten (EDR-Alarm)
- Keine git-Befehle ohne ausdrückliches OK; committen/pushen macht ausschließlich der Nutzer
- Keine Emoji-Icons (Noir/Case-File-Stil: handgezeichnete Linien-Art)
