import type {
  Building,
  CreateBuildingRequest,
  CreateRoomBlockRequest,
  CreateRoomRequest,
  CreateRoomTypeRequest,
  Room,
  RoomBlock,
  RoomType,
} from '@hotel/contracts';
import type { PropertyTransport } from '../../http.js';

/** Buildings, room types, rooms and room blocks. */
export function inventoryClient({ call, p, id }: PropertyTransport) {
  return {
    buildings: () => call<Building[]>('GET', `${p}/buildings`).then((r) => r.data),
    createBuilding: (body: CreateBuildingRequest) =>
      call<Building>('POST', `${p}/buildings`, body).then((r) => r.data),
    roomTypes: () => call<RoomType[]>('GET', `${p}/room-types`).then((r) => r.data),
    createRoomType: (body: CreateRoomTypeRequest) =>
      call<RoomType>('POST', `${p}/room-types`, body).then((r) => r.data),
    rooms: () => call<Room[]>('GET', `${p}/rooms`).then((r) => r.data),
    createRoom: (body: CreateRoomRequest) =>
      call<Room>('POST', `${p}/rooms`, body).then((r) => r.data),
    roomBlocks: (roomId: string) =>
      call<RoomBlock[]>('GET', `${p}/rooms/${id(roomId)}/blocks`).then((r) => r.data),
    blockRoom: (roomId: string, body: CreateRoomBlockRequest) =>
      call<RoomBlock>('POST', `${p}/rooms/${id(roomId)}/blocks`, body).then((r) => r.data),
    releaseBlock: (roomId: string, blockId: string) =>
      call<void>('DELETE', `${p}/rooms/${id(roomId)}/blocks/${id(blockId)}`).then((r) => r.data),
  };
}
