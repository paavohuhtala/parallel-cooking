import { test, type BrowserContext } from '@playwright/test'
import type { RoomSummary } from '../src/shared/api.ts'
import { KitchenPageModel } from './pom/KitchenPageModel.ts'
import { LandingPageModel } from './pom/LandingPageModel.ts'
import { MenuEditorModel } from './pom/MenuEditorModel.ts'
import { MenuLibraryModel } from './pom/MenuLibraryModel.ts'
import { startBackend, type BackendServer } from './server.ts'
import { TestApiClient } from './testApiClient.ts'

interface PcWorkerFixtures {
  /** This worker's own server process and SQLite file. */
  backend: BackendServer
}

interface PcTestFixtures {
  api: TestApiClient
  /** A room of this test's own, created before the test body runs. */
  room: RoomSummary
  landingPage: LandingPageModel
  /** The menu list inside the landing page's "Uusi keittiö" card. */
  library: MenuLibraryModel
  /** The menu outliner, wherever it is open. */
  editor: MenuEditorModel
  /** The kitchen page object for `page`; the test navigates it. */
  kitchen: KitchenPageModel
  /** A second cook: another browser context on the same room. */
  openSecondCook: () => Promise<KitchenPageModel>
  /** Attaches the server's output to a failing test. Runs for every test. */
  serverOutputOnFailure: void
}

/**
 * Every worker gets a backend of its own, so tests are free to run fully
 * parallel: nothing they create is visible to another worker. Within a worker
 * the database is shared, which is fine because a room is the unit of
 * isolation — each test works in a room it created.
 */
export const pcTest = test.extend<PcTestFixtures, PcWorkerFixtures>({
  backend: [
    async ({}, use) => {
      const backend = await startBackend()
      await use(backend)
      await backend.stop()
    },
    { scope: 'worker' },
  ],

  // Points `page.goto('/')`, `request` and any new context at this worker's server.
  baseURL: async ({ backend }, use) => {
    await use(backend.url)
  },

  api: async ({ request }, use) => {
    await use(new TestApiClient(request))
  },

  room: async ({ api }, use, testInfo) => {
    // Naming the room after the test makes a failure screenshot self-explanatory.
    await use(await api.createRoomFromDefaultMenu(testInfo.title.slice(0, 80)))
  },

  library: async ({ page }, use) => {
    await use(new MenuLibraryModel(page))
  },

  editor: async ({ page }, use) => {
    await use(new MenuEditorModel(page))
  },

  serverOutputOnFailure: [
    async ({ backend }, use, testInfo) => {
      // The server is shared by the worker, so only the slice written while
      // this test ran is worth attaching.
      const before = backend.output().length
      await use()
      if (testInfo.status === testInfo.expectedStatus) return
      await testInfo.attach('server output', {
        body: backend.output().slice(before),
        contentType: 'text/plain',
      })
    },
    { auto: true },
  ],

  landingPage: async ({ page }, use) => {
    await use(new LandingPageModel(page))
  },

  kitchen: async ({ page }, use) => {
    await use(new KitchenPageModel(page))
  },

  openSecondCook: async ({ browser, baseURL, room }, use) => {
    const opened: BrowserContext[] = []
    await use(async () => {
      // A separate context, not just a separate page: which cook you are lives
      // in localStorage, and two cooks must not share it.
      const context = await browser.newContext({ baseURL })
      opened.push(context)
      const kitchen = new KitchenPageModel(await context.newPage())
      await kitchen.goto(room.id)
      return kitchen
    })
    for (const context of opened) await context.close()
  },
})

export { expect } from '@playwright/test'
