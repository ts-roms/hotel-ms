# Uploaded files (employee documents, ADR-0019). Private, TLS-only, every object
# encrypted with the platform KMS key (SSE-KMS). Versioned, so a deleted document can be
# recovered for a short window before it is gone for good.
resource "aws_s3_bucket" "documents" {
  bucket        = "${var.name}-documents-${local.account_id}"
  force_destroy = var.environment != "production"
  tags          = local.tags
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.platform.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket     = aws_s3_bucket.documents.id
  depends_on = [aws_s3_bucket_versioning.documents]

  rule {
    id     = "expire-deleted-documents"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.deleted_document_retention_days
    }
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # Punch selfies (ADR-0022): the API deletes them after the organization's retention
  # period (7-365 days); this backstop also removes any a crash left without a punch.
  rule {
    id     = "expire-attendance-photos"
    status = "Enabled"
    filter {
      tag {
        key   = "retention"
        value = "attendance-photo"
      }
    }
    expiration {
      days = var.attendance_photo_expiry_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
}

data "aws_iam_policy_document" "documents_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
  statement {
    sid       = "DenyOtherEncryptionKeys"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEqualsIfExists"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.platform.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket     = aws_s3_bucket.documents.id
  policy     = data.aws_iam_policy_document.documents_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.documents]
}

# Only the API task reads and writes documents; nothing may list the bucket.
data "aws_iam_policy_document" "api_documents" {
  statement {
    actions   = ["s3:PutObject", "s3:PutObjectTagging", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }
  statement {
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.platform.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${local.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api_documents" {
  name   = "documents"
  role   = aws_iam_role.task["api"].id
  policy = data.aws_iam_policy_document.api_documents.json
}
