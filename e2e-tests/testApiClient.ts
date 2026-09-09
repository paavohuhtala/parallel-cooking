import { expect, type APIRequestContext } from '@playwright/test'
import type { CreateRoomBody, RoomSummary, TemplateSummary } from '../src/shared/api.ts'

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

  async roomExists(id: string): Promise<boolean> {
    const res = await this.request.get(`/api/rooms/${encodeURIComponent(id)}`)
    return res.ok()
  }
}
