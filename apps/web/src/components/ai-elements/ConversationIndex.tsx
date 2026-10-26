import { Button } from "@/components/ui/button";
import { useMessageScroller, useMessageScrollerVisibility } from "@/components/ui/message-scroller";

type ConversationRound = { id: string; task: string };

export function ConversationIndex({ rounds }: { rounds: ConversationRound[] }) {
  const { scrollToMessage } = useMessageScroller();
  const { currentAnchorId, visibleMessageIds } = useMessageScrollerVisibility();
  const currentId = currentAnchorId ?? visibleMessageIds[0];

  if (rounds.length <= 20) return null;

  return (
    <nav className="conversation-index" aria-label="对话轮次导航">
      {rounds.map((round, index) => {
        const label = `第 ${index + 1} 轮：${round.task.replace(/\s+/g, " ").slice(0, 80)}`;
        const selected = currentId === `${round.id}-user` || currentId === `${round.id}-agent`;
        return (
          <Button
            key={round.id}
            type="button"
            variant="ghost"
            className="conversation-index-tick"
            aria-label={label}
            title={label}
            aria-current={selected ? "location" : undefined}
            onClick={() => scrollToMessage(`${round.id}-user`, {
              align: "start",
              // The content's 100px top padding already clears the floating header.
              scrollMargin: 0,
              behavior: "instant",
            })}
          >
            <span aria-hidden="true" />
          </Button>
        );
      })}
    </nav>
  );
}
