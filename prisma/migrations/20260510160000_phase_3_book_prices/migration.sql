-- CreateTable
CREATE TABLE "book_prices" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "unit_amount_cents" INTEGER NOT NULL,
    "stripe_price_id" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "book_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "book_prices_stripe_price_id_key" ON "book_prices"("stripe_price_id");

-- CreateIndex
CREATE UNIQUE INDEX "book_prices_book_id_currency_key" ON "book_prices"("book_id", "currency");

-- AddForeignKey
ALTER TABLE "book_prices" ADD CONSTRAINT "book_prices_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
