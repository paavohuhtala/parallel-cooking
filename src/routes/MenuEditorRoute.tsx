import { useNavigate, useLoaderData } from '@tanstack/react-router'
import { createRoom, saveMenu } from '../api/client.ts'
import { MenuEditor } from '../components/MenuEditor.tsx'
import type { MenuDetail } from '../shared/api.ts'
import { cx } from '../components/cx.ts'
import ui from '../components/ui.module.css'
import styles from './MenuEditorRoute.module.css'

/** The library editor. A room's own menu is edited from inside the room instead. */
export default function MenuEditorRoute() {
  const detail = useLoaderData({ from: '/m/$menuId' }) as MenuDetail
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a className={cx(ui.btn, ui.btnGhost)} href="/">
          ← Menut
        </a>
        <button
          className={ui.btn}
          onClick={() => {
            void createRoom({ fromMenuId: detail.id }).then((room) =>
              navigate({ to: '/r/$roomId', params: { roomId: room.id } }),
            )
          }}
        >
          Käynnistä keittiö
        </button>
      </nav>

      <MenuEditor
        initial={detail.menu}
        initialVersion={detail.version}
        storageKey={`parallel-cooking/menuDraft/${detail.id}`}
        save={(menu, expectedVersion) => saveMenu(detail.id, menu, expectedVersion)}
      />
    </div>
  )
}
