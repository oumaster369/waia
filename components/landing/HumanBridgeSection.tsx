import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { NarrativeMediaSlot } from "@/components/landing/NarrativeMediaSlot";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";

const copy = HOMEPAGE_COPY.humanBridge;

export function HumanBridgeSection() {
  return (
    <HomepageSection testId="landing-human-bridge" ariaLabel="It starts with the human">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-human-bridge-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-human-bridge-body">{copy.body}</SectionBody>
        </div>
        <NarrativeMediaSlot
          testId="landing-human-bridge-media"
          purpose="Human-first bridge visual"
        />
      </div>
    </HomepageSection>
  );
}
