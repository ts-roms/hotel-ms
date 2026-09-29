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
import * as op from '../../generated/operations.js';
import { data, type PropertyTransport } from '../../http.js';

/** Buildings, room types, rooms and room blocks. */
export function inventoryClient({ call, propertyId }: PropertyTransport) {
  return {
    buildings: () =>
      op.InventoryController_listBuildings<Building[]>(call, { propertyId }).then(data),
    createBuilding: (body: CreateBuildingRequest) =>
      op.InventoryController_createBuilding<Building>(call, { propertyId }, body).then(data),
    roomTypes: () =>
      op.InventoryController_listRoomTypes<RoomType[]>(call, { propertyId }).then(data),
    createRoomType: (body: CreateRoomTypeRequest) =>
      op.InventoryController_createRoomType<RoomType>(call, { propertyId }, body).then(data),
    rooms: () => op.InventoryController_listRooms<Room[]>(call, { propertyId }).then(data),
    createRoom: (body: CreateRoomRequest) =>
      op.InventoryController_createRoom<Room>(call, { propertyId }, body).then(data),
    roomBlocks: (roomId: string) =>
      op.InventoryController_listBlocks<RoomBlock[]>(call, { propertyId, roomId }).then(data),
    blockRoom: (roomId: string, body: CreateRoomBlockRequest) =>
      op.InventoryController_createBlock<RoomBlock>(call, { propertyId, roomId }, body).then(data),
    releaseBlock: (roomId: string, blockId: string) =>
      op.InventoryController_releaseBlock(call, { propertyId, roomId, blockId }).then(data),
  };
}
