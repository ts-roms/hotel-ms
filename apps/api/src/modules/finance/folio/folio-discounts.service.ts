import { Inject, Injectable } from '@nestjs/common';
import type { Folio } from '@hotel/contracts';
import { ClsService } from 'nestjs-cls';
import { Problems, invalidState } from '../../../common/problem.js';
import type { RequestContext } from '../../../common/request-context.js';
import { TenantDb } from '../../../infrastructure/database.js';
import { SECRET_BOX, type SecretBox } from '../../../infrastructure/secret-box.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../outbox/outbox.service.js';
import { FolioService } from './folio.service.js';

/**
 * Statutory discounts on a folio (§15.1, e.g. PH senior citizen / PWD): the holder's ID is
 * stored encrypted; FolioService applies the discount to later charges.
 */
@Injectable()
export class FolioDiscountsService {
  constructor(
    private readonly db: TenantDb,
    private readonly folios: FolioService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(SECRET_BOX) private readonly secretBox: SecretBox,
  ) {}

  private get ctx() {
    return { propertyId: this.cls.get('propertyId')! };
  }

  /** Applies a discount profile to a folio; its later charges are discounted (§15.1). */
  async applyDiscount(
    folioId: string,
    input: { profileId: string; holderName: string; idNumber: string },
  ): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.folios.requireInTx(tx, folioId);
      if (folio.status !== 'OPEN') throw invalidState('The folio is closed.');
      const profile = await tx.discountProfile.findFirst({
        where: { id: input.profileId, propertyId, archivedAt: null },
      });
      if (!profile) throw Problems.validation([{ path: 'profileId', message: 'Unknown discount' }]);
      const id = input.idNumber.replace(/\s+/g, '');
      await tx.folio.update({
        where: { id: folioId },
        data: {
          discountProfileId: profile.id,
          discountHolderName: input.holderName,
          discountIdLast4: id.slice(-4),
          // Bound to this folio, so a copied ciphertext cannot be read elsewhere.
          discountIdEncrypted: new Uint8Array(
            this.secretBox.encrypt(id, `folio-discount:${folioId}`),
          ),
        },
      });
      await this.audit.record(tx, {
        action: 'folio.discount_applied',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
        after: { profile: profile.code, holderName: input.holderName, idLast4: id.slice(-4) },
      });
      await this.outbox.enqueue(
        tx,
        'FolioDiscountApplied',
        { folioId, profileCode: profile.code },
        { propertyId },
      );
      return this.folios.loadInTx(tx, folioId);
    });
  }

  async removeDiscount(folioId: string): Promise<Folio> {
    const { propertyId } = this.ctx;
    return this.db.run(async (tx) => {
      const folio = await this.folios.requireInTx(tx, folioId);
      if (!folio.discountProfileId) return this.folios.loadInTx(tx, folioId);
      await tx.folio.update({
        where: { id: folioId },
        data: {
          discountProfileId: null,
          discountHolderName: null,
          discountIdLast4: null,
          discountIdEncrypted: null,
        },
      });
      await this.audit.record(tx, {
        action: 'folio.discount_removed',
        entityType: 'folio',
        entityId: folioId,
        propertyId,
      });
      return this.folios.loadInTx(tx, folioId);
    });
  }
}
