import { useEffect, useState } from "react";
import LeluCharacterStore from "../../../../core/avatar/LeluCharacterStore";

/** Her current look and form, re-rendering when either changes. */
export function useLeluCharacter() {
  const [state, setState] = useState(() => LeluCharacterStore.getInstance().get());
  useEffect(() => LeluCharacterStore.getInstance().subscribe(setState), []);
  return state;
}
