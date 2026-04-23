import { Plus, Send } from "lucide-react";
import {
  ChatLayout,
  ChatLayoutNewChatAction,
} from "@/components/primitives/chat-layout";

export default async function AskPage(props: PageProps<"/trip/[id]/ask">) {
  const { id } = await props.params;

  return (
    <ChatLayout
      title="Ask Autopilot"
      subtitle={`TRIP · ${id.toUpperCase()}`}
      closeHref={`/trip/${id}`}
      headerAction={<ChatLayoutNewChatAction />}
      input={<AskComposer />}
    >
      <div className="text-text-muted font-sans">
        Chat stub — messages stream here.
      </div>
    </ChatLayout>
  );
}

function AskComposer() {
  return (
    <>
      <button
        type="button"
        aria-label="Attach"
        className="w-10 h-10 flex items-center justify-center rounded-full bg-bg-card border border-border-subtle shrink-0 text-text-primary"
      >
        <Plus className="w-4 h-4" />
      </button>
      <input
        type="text"
        placeholder="Ask about anything"
        className="form-field flex-1"
      />
      <button
        type="button"
        aria-label="Send"
        className="w-10 h-10 flex items-center justify-center rounded-full bg-button-primary border border-button-primary-border shrink-0 text-text-primary"
      >
        <Send className="w-4 h-4" />
      </button>
    </>
  );
}
