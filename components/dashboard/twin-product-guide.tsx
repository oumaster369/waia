"use client";

import * as React from "react";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { TWIN_PRODUCT_GUIDE } from "@/lib/ai-twin/product-guide";
import { cn } from "@/lib/utils";

/** In-place optional help. Never unmounts or changes the conversation's state. */
export function TwinProductGuide() {
  const [open, setOpen] = React.useState(false);
  const [topicId, setTopicId] = React.useState<string>("conversation");
  const trigger = React.useRef<HTMLButtonElement>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const id = React.useId();
  const topic = TWIN_PRODUCT_GUIDE.topics.find((item) => item.id === topicId)!;
  React.useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className="min-w-0 shrink-0"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex justify-end">
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={`${id}-guide`}
          onClick={() => (open ? close() : setOpen(true))}
          className="min-h-11 gap-2 text-sm"
        >
          <BookOpen aria-hidden="true" className="size-4" />
          Using WAIA
        </Button>
      </div>
      {open && (
        <WaiaSurface
          id={`${id}-guide`}
          role="region"
          aria-labelledby={`${id}-heading`}
          variant="raised"
          className="mt-2 min-w-0 space-y-5 p-4 [overflow-wrap:anywhere] sm:p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                ref={heading}
                tabIndex={-1}
                id={`${id}-heading`}
                className="text-waia-fg text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                Using WAIA
              </h2>
              <p className="text-waia-fg-muted mt-1 text-base leading-relaxed">
                Choose what you would like to learn. Your conversation stays here.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={close}
              aria-label="Close guide"
              className="min-h-11 min-w-11 shrink-0"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div role="group" aria-label="Guide topics" className="flex flex-wrap gap-2">
            {TWIN_PRODUCT_GUIDE.topics.map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="ghost"
                aria-pressed={topicId === item.id}
                onClick={() => setTopicId(item.id)}
                className={cn(
                  "h-auto min-h-11 max-w-full justify-start text-left text-sm whitespace-normal",
                  topicId === item.id && "bg-waia-elevated text-waia-fg ring-waia-rim ring-1",
                )}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <section
            aria-labelledby={`${id}-topic`}
            className="max-w-prose space-y-3 text-base leading-relaxed"
          >
            <h3 id={`${id}-topic`} className="text-waia-fg font-medium">
              {topic.title}
            </h3>
            <ol className="text-waia-fg list-decimal space-y-3 pl-6">
              {topic.steps.map((step) => (
                <li key={step} className="pl-1">
                  {step}
                </li>
              ))}
            </ol>
            <p className="text-waia-fg-muted">{topic.note}</p>
          </section>
          <Button
            type="button"
            variant="outline"
            onClick={close}
            className="h-auto min-h-11 whitespace-normal"
          >
            Return to conversation
          </Button>
        </WaiaSurface>
      )}
    </div>
  );
}
