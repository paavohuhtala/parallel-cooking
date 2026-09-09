import type { Menu } from '../model/types.ts'
import { MENU } from '../data/menu.ts'

/**
 * Starter menus, authored in code. A room copies one into its own `menu` row at
 * creation, so editing a room's menu later never touches anyone else's dinner.
 * In development a room keeps *following* its template, which is what makes
 * iterating on `src/data/menu.ts` show up without recreating the room.
 */
export interface MenuTemplate {
  id: string
  name: string
  description?: string
  menu: Menu
}

export const MENU_TEMPLATES: MenuTemplate[] = [
  {
    id: 'nelja-ruokalajia',
    name: MENU.name,
    description: 'Kantarellikeitto ja valkosipulibruschetta.',
    menu: MENU,
  },
]

export const templateById = (id: string): MenuTemplate | null =>
  MENU_TEMPLATES.find((t) => t.id === id) ?? null
