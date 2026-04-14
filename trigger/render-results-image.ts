import { logger, schemaTask } from "@trigger.dev/sdk/v3";

import { renderAndStoreOnpeResultsImage } from "@/lib/render-results-image-storage";
import { onpeResultsImagePayloadSchema } from "@/lib/render-results";

export const renderOnpeResultsImage = schemaTask({
  id: "render-onpe-results-image",
  schema: onpeResultsImagePayloadSchema,
  maxDuration: 300,
  queue: {
    concurrencyLimit: 1,
  },
  run: async (payload) => {
    const result = await renderAndStoreOnpeResultsImage(payload);

    logger.info("Uploaded ONPE results image", {
      blobPath: result.pathname,
      url: result.url,
      topCount: result.topCount,
      updatedAt: result.updatedAt,
    });

    return result;
  },
});
