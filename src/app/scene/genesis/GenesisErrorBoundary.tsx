import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { thrownMessage } from "./thrownMessage";


interface Props {

  children:

    ReactNode;

}


interface State {

  /**
   * Whether something below threw. Kept apart from the error itself: a
   * thrown `undefined` left `error` falsy, so the boundary rendered its
   * children again, which threw again.
   */
  failed: boolean;

  error:

    unknown;

}


export default class GenesisErrorBoundary
  extends Component<Props, State> {


  state: State = {

    failed: false,

    error: null,

  };



  static getDerivedStateFromError(

    error: unknown,

  ): State {


    return {

      failed: true,

      error,

    };

  }



  componentDidCatch(

    error: unknown,

    info: ErrorInfo,

  ) {


    console.error(

      "GENESIS CRASH",

      error,

      info,

    );

  }



  render() {


    if (this.state.failed) {


      return (

        <div

          style={{

            color:"white",

            background:"black",

            padding:"20px",

            fontSize:"18px",

          }}

        >

          GENESIS CRASH:

          <br />

          {thrownMessage(this.state.error)}

        </div>

      );

    }


    return this.props.children;

  }

}