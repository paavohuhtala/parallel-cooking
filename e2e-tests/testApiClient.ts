import { expect, type APIRequestContext } from '@playwright/test'
import type {
  CreateRoomBody,
  MenuDetail,
  MenuImportResponse,
  MenuSummary,
  MenuWriteResponse,
  RoomSummary,
  TemplateSummary,
} from '../src/shared/api.ts'
import type { Menu } from '../src/model/types.ts'

/**
 * The REST surface, used to *arrange* a test. Everything a cook does goes
 * through a page object instead — this exists so a test about the kitchen does
 * not have to start by clicking through the landing page, and so a test can
 * check what the server really stored.
 */
export class TestApiClient {
  private readonly request: APIRequestContext

  constructor(request: APIRequestContext) {
    this.request = request
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    const res = await this.request.get('/api/templates')
    await expect(res).toBeOK()
    return (await res.json()) as TemplateSummary[]
  }

  async createRoom(body: CreateRoomBody): Promise<RoomSummary> {
    const res = await this.request.post('/api/rooms', { data: body })
    await expect(res).toBeOK()
    return (await res.json()) as RoomSummary
  }

  /** The suite has one menu template; a test that does not care takes it. */
  async createRoomFromDefaultMenu(name: string): Promise<RoomSummary> {
    const [template] = await this.listTemplates()
    expect(template, 'the server offers no menu templates').toBeTruthy()
    return this.createRoom({ templateId: template.id, name })
  }

  async listMenus(): Promise<MenuSummary[]> {
    const res = await this.request.get('/api/menus')
    await expect(res).toBeOK()
    return (await res.json()) as MenuSummary[]
  }

  async getMenu(id: string): Promise<MenuDetail> {
    const res = await this.request.get(`/api/menus/${encodeURIComponent(id)}`)
    await expect(res).toBeOK()
    return (await res.json()) as MenuDetail
  }

  async getRoomMenu(roomId: string): Promise<MenuDetail> {
    const res = await this.request.get(`/api/rooms/${encodeURIComponent(roomId)}/menu`)
    await expect(res).toBeOK()
    return (await res.json()) as MenuDetail
  }

  /** Creates a library menu from the suite's one code template. */
  async createLibraryMenuFromTemplate(name?: string): Promise<MenuDetail> {
    const [template] = await this.listTemplates()
    const res = await this.request.post('/api/menus', {
      data: { templateId: template.id, ...(name === undefined ? {} : { name }) },
    })
    await expect(res).toBeOK()
    return (await res.json()) as MenuDetail
  }

  /** Raw, so a test can assert on a rejection as easily as on a success. */
  async importMenu(
    doc: unknown,
    opts: { name?: string; dryRun?: boolean } = {},
  ): Promise<{ status: number; body: MenuImportResponse & { id?: string; error?: string } }> {
    const res = await this.request.post('/api/menus/import', { data: { ...opts, doc } })
    return { status: res.status(), body: await res.json() }
  }

  async saveMenu(
    id: string,
    menu: Menu,
    expectedVersion: number,
  ): Promise<{ status: number; body: MenuWriteResponse & { error?: string } }> {
    const res = await this.request.put(`/api/menus/${encodeURIComponent(id)}`, {
      data: { expectedVersion, menu },
    })
    return { status: res.status(), body: await res.json() }
  }

  async saveRoomMenu(
    roomId: string,
    menu: Menu,
    expectedVersion: number,
  ): Promise<{ status: number; body: MenuWriteResponse & { error?: string } }> {
    const res = await this.request.put(`/api/rooms/${encodeURIComponent(roomId)}/menu`, {
      data: { expectedVersion, menu },
    })
    return { status: res.status(), body: await res.json() }
  }

  async deleteMenu(id: string): Promise<number> {
    return (await this.request.delete(`/api/menus/${encodeURIComponent(id)}`)).status()
  }

  /** The status only: refusing to delete a busy kitchen is as interesting as doing it. */
  async deleteRoom(id: string): Promise<number> {
    return (await this.request.delete(`/api/rooms/${encodeURIComponent(id)}`)).status()
  }

  async roomExists(id: string): Promise<boolean> {
    const res = await this.request.get(`/api/rooms/${encodeURIComponent(id)}`)
    return res.ok()
  }
}
