import { useNavigate, useLoaderData } from '@tanstack/react-router'
import { createRoom, saveMenu } from '../api/client.ts'
import { MenuEditor } from '../components/MenuEditor.tsx'
import type { MenuDetail } from '../shared/api.ts'

/** The library editor. A room's own menu is edited from inside the room instead. */
export default function MenuEditorRoute() {
  const detail = useLoaderData({ from: '/m/$menuId' }) as MenuDetail
  const navigate = useNavigate()

  return (
    <div className="editor-page">
      <nav className="editor-nav">
        <a className="btn btn-ghost" href="/">
          ← Menut
        </a>
        <button
          className="btn"
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
