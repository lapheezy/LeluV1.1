/**
 * ==========================================================
 * LÉLU
 * MEMORY STORE
 * ==========================================================
 */


import type {
  MemoryCategory,
} from "../../brain/ResponsePattern";





export type MemorySpace =

  | "user"

  | "lelu"

  | "shared"

  | "log"

  | "reflection"

  | "research"

  | "project";





export interface MemoryMetadata {


  category?:
    MemoryCategory;



  prompt?:
    string;



  intent?:
    string;



  source?:
    string;



  context?:
    Record<
      string,
      unknown
    >;



  createdBy?:
    string;



  confidence?:
    number;

}





export interface MemoryRecord {


  id:
    string;



  space:
    MemorySpace;



  title:
    string;



  content:
    string;



  tags:
    string[];



  importance:
    number;



  created:
    number;



  updated:
    number;



  metadata?:
    MemoryMetadata;

}





export default interface MemoryStore {


  initialize():
    Promise<void>;



  save(

    memory:
      MemoryRecord,

  ):
    Promise<void>;



  update(

    memory:
      MemoryRecord,

  ):
    Promise<void>;



  delete(

    id:
      string,

  ):
    Promise<void>;



  clear():
    Promise<void>;



  get(

    id:
      string,

  ):
    Promise<MemoryRecord | null>;



  search(

    query:
      string,


    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]>;



  recent(

    limit?:
      number,


    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]>;



  all(

    space?:
      MemorySpace,

  ):
    Promise<MemoryRecord[]>;

}