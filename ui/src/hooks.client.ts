import { installRequestGate } from '$lib/adapter/gate';

// Before any page or loader asks the server for anything.
installRequestGate();
