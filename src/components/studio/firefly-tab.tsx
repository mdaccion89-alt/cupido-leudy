import { VideoStudio, type VideoStudioProps } from "./video-studio";

export type FireflyTabProps = VideoStudioProps;

export function FireflyTab(props: FireflyTabProps) {
  return <VideoStudio {...props} />;
}
