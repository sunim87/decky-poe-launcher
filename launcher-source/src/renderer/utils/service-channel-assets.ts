import imgGGG from "../assets/img-ci-ggg_150x67.png";
import imgKakao from "../assets/img-ci-kakaogames_158x28.png";

import type { ServiceChannel } from "../../shared/types";

interface ServiceChannelAsset {
  logo: string;
  alt: string;
}

export const SERVICE_CHANNEL_ASSETS: Record<
  ServiceChannel,
  ServiceChannelAsset
> = {
  "Kakao Games": {
    logo: imgKakao,
    alt: "Kakao Games",
  },
  GGG: {
    logo: imgGGG,
    alt: "Grinding Gear Games",
  },
};
