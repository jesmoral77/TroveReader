/**
 * Development only: fills the browser backend with a demo library, shelves,
 * reading progress and a few highlights. Open the dev server with `/?demo`.
 */
import { DEMO_ROOT } from './backend-browser'
import { addFolder, processMetadataQueue } from './library'
import { addToShelf, createShelf, saveProgress, setType, updateBooks, upsertAnnotation, useStore } from './store'
import type { BookType } from './types'

export async function seedDemo() {
  if (useStore.getState().folders.length) return
  await addFolder(DEMO_ROOT)
  await processMetadataQueue()

  const s = useStore.getState()
  const byFile = (name: string) => Object.values(s.books).find((b) => b.path.endsWith(`\\${name}`))?.id
  const ids = (...names: string[]) => names.map(byFile).filter((x): x is string => !!x)
  const root = (name: string) => s.shelves.find((x) => x.parentId == null && x.name === name)!.id

  const projects = root('Projects')
  const topics = root('Topics')
  const dialogic = await createShelf(projects, 'Dialogic Studio')
  const flowstate = await createShelf(projects, 'Flowstate')
  await createShelf(projects, 'Befriending Life')
  const strategy = await createShelf(topics, 'Strategy')
  const story = await createShelf(topics, 'Storytelling')
  const tech = await createShelf(topics, 'Technology')
  const teachers = await createShelf(null, 'Teachers')
  const hale = await createShelf(teachers, 'Erin Hale')

  await addToShelf(
    ids(
      'Agile_Strategy_Guide.pdf', 'Comms_Strategy_in_Ten_Rules.pdf', 'The_Artist_and_Integrity.pdf', 'Building Trust at Work.pdf',
      'Effectual_Reasoning_in_Early_Ventures.pdf', 'The Quiet Engine.epub', 'Rivers Without Maps.epub', 'Little_Grey_Book_of_Leadership.pdf',
      'Me_as_a_Service.pdf', 'Archetypes_for_Storytellers.pdf', 'Brand_Tactics.pdf', 'Storyteller_Tactics.pdf', 'Strategy_Tactics_Cards.pdf',
      'Signal and Kinship.epub', 'Start_Doing_the_Work.pdf', 'Activate_Your_Network.pdf', 'Lead_Generation_Made_Simple.pdf',
      'Pricing_Playbook.pdf', 'Supercharge_Your_Profile.pdf', 'Where the Network Began.pdf', 'Notes on Dialogue.md',
    ),
    dialogic,
  )
  await addToShelf(ids('Phenomenology_of_the_Hand.pdf'), flowstate)
  await addToShelf(ids('Agile_Strategy_Guide.pdf', 'Strategy_Tactics_Cards.pdf', 'Effectual_Reasoning_in_Early_Ventures.pdf'), strategy)
  await addToShelf(ids('Storyteller_Tactics.pdf', 'Archetypes_for_Storytellers.pdf', 'Rivers Without Maps.epub'), story)
  await addToShelf(ids('Where the Network Began.pdf', 'Signal and Kinship.epub'), tech)
  await addToShelf(ids('Pricing_Playbook.pdf', 'Supercharge_Your_Profile.pdf', 'Activate_Your_Network.pdf', 'Lead_Generation_Made_Simple.pdf'), hale)

  const types: [string[], BookType][] = [
    [ids('Archetypes_for_Storytellers.pdf', 'Brand_Tactics.pdf', 'Storyteller_Tactics.pdf', 'Strategy_Tactics_Cards.pdf'), 'course'],
    [ids('Pricing_Playbook.pdf', 'Supercharge_Your_Profile.pdf', 'Activate_Your_Network.pdf', 'Lead_Generation_Made_Simple.pdf'), 'course'],
    [ids('Me_as_a_Service.pdf', 'Start_Doing_the_Work.pdf', 'Comms_Strategy_in_Ten_Rules.pdf', 'The_Artist_and_Integrity.pdf'), 'article'],
    [ids('Effectual_Reasoning_in_Early_Ventures.pdf', 'Phenomenology_of_the_Hand.pdf'), 'paper'],
    [ids('Little_Grey_Book_of_Leadership.pdf', 'Agile_Strategy_Guide.pdf'), 'summary'],
    [ids('Call transcript - studio kickoff.txt'), 'conversation'],
  ]
  for (const [list, t] of types) await setType(list, t)

  const now = Date.now()
  const progress: [string, number, string][] = [
    ['The Quiet Engine.epub', 0.42, 'Small Decisions'],
    ['Where the Network Began.pdf', 0.18, 'Chapter 3'],
    ['Storyteller_Tactics.pdf', 0.66, 'Practice'],
    ['A Field Guide to Attention.epub', 0.08, 'Beginnings'],
  ]
  for (const [file, fraction, label] of progress) {
    const id = byFile(file)
    if (id) {
      await saveProgress({ bookId: id, locator: null, fraction, label, updatedAt: now })
      await updateBooks([id], { openedAt: now - Math.round(fraction * 1e7) })
    }
  }
  const finished = byFile('Pricing_Playbook.pdf')
  if (finished) await updateBooks([finished], { finishedAt: now, openedAt: now - 9e7 })
  await updateBooks(ids('The Quiet Engine.epub', 'Brand_Tactics.pdf'), { starred: true })

  const md = byFile('Notes on Dialogue.md')
  if (md) {
    // find a real sentence so the demo highlight lines up with the rendered text
    const { marked } = await import('marked')
    const raw = await (await fetch('/demo/Notes%20on%20Dialogue.md')).text()
    const text = new DOMParser().parseFromString(marked.parse(raw, { async: false }) as string, 'text/html').body.textContent ?? ''
    const sentence = 'Every good strategy begins as a description.'
    const start = text.indexOf(sentence)
    if (start >= 0)
      await upsertAnnotation({
        id: crypto.randomUUID(),
        bookId: md,
        kind: 'highlight',
        locator: `txthl:${start}:${start + sentence.length}`,
        text: sentence,
        note: 'Use this framing in the studio kickoff.',
        color: 'yellow',
        label: 'Listening first',
        fraction: 0.05,
        createdAt: now - 3600_000,
        updatedAt: now - 3600_000,
      })
  }
}
