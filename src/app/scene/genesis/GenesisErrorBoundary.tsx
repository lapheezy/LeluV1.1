import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from "react";


interface Props {

  children:

    ReactNode;

}


interface State {

  error:

    Error | null;

}


export default class GenesisErrorBoundary
  extends Component<Props, State> {


  state: State = {

    error: null,

  };



  static getDerivedStateFromError(

    error: Error,

  ) {


    return {

      error,

    };

  }



  componentDidCatch(

    error: Error,

    info: ErrorInfo,

  ) {


    console.error(

      "GENESIS CRASH",

      error,

      info,

    );

  }



  render() {


    if (this.state.error) {


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

          {this.state.error.message}

        </div>

      );

    }


    return this.props.children;

  }

}