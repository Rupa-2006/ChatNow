import { ChatWorkspace } from '@/components/chat/ChatWorkspace';
import { RightSidebar } from '@/components/details/RightSidebar';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';

export function ChatPage() {
  const mobilePane = useUiStore((s) => s.mobilePane);
  const rightPanelOpen = useUiStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen);

  useKeyboardShortcuts({
    onEscape: () => {
      if (rightPanelOpen && window.innerWidth < 1280) {
        setRightPanelOpen(false);
      }
    },
  });

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {/* Left Sidebar: full-width on mobile when mobilePane==='sidebar', fixed rail on md+ */}
      <div
        className={cn(
          'h-full w-full md:w-auto md:block',
          mobilePane === 'sidebar' ? 'block' : 'hidden',
        )}
      >
        <LeftSidebar />
      </div>

      {/* Main Chat Pane: hidden on mobile when browsing sidebar */}
      <div
        className={cn(
          'min-h-0 min-w-0 flex-1 flex-col md:flex',
          mobilePane === 'chat' ? 'flex' : 'hidden',
        )}
      >
        <ChatWorkspace />
      </div>

      {/* Right Details Panel */}
      <RightSidebar />
    </div>
  );
}
