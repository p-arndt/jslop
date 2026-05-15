// Hydrates the SSR'd RowsApp on the page. Playwright drives operations by
// clicking the buttons inside the component, exactly like a user would —
// no out-of-band reach into the framework's internals.
import { boot } from "@jslop/client";
import RowsApp from "./RowsApp.jslop";

boot({ [RowsApp.name]: RowsApp });
