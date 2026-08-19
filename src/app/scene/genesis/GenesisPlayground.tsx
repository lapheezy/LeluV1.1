/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS PLAYGROUND
 *
 * Interactive space for:
 * - world clicks
 * - experiments
 * - navigation targets
 * - Genesis exploration
 * ==========================================================
 */


import { useGenesis } from "./GenesisCore";
import type GenesisNavigator from "./GenesisNavigator";





interface GenesisPlaygroundProps {


  navigator:

    GenesisNavigator;

}





export default function GenesisPlayground({

  navigator,

}: GenesisPlaygroundProps) {

  const { selectDestination } = useGenesis();


  function travelToCore() {

    selectDestination({
      id: "genesis-core",
      type: "core",
      name: "Genesis Core",
      position: { x: 0, y: 0, z: 0 },
    });

    navigator.navigate({

      id:

        "genesis-core",


      type:

        "core",


      name:

        "Genesis Core",


      position:

      {

        x:

          0,


        y:

          0,


        z:

          0,

      },

    });

  }





  return (

    <group>
      <mesh
        onClick={travelToCore}
        position={[0, -1, 0]}
        visible={false}
      >
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial />
      </mesh>
    </group>

  );

}