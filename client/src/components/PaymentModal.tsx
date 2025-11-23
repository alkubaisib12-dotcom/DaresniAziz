import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatMoney } from "@/lib/currency";

type PaymentMethod = "paypal" | "applepay" | "benefitpay";

type PaymentModalProps = {
  totalAmount: number;
  onClose: () => void;
  onConfirmPayment: (paymentMethod: PaymentMethod) => void;
  isProcessing?: boolean;
};

export function PaymentModal({
  totalAmount,
  onClose,
  onConfirmPayment,
  isProcessing = false,
}: PaymentModalProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod>("paypal");

  const handlePayment = () => {
    onConfirmPayment(selectedPaymentMethod);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="modal-payment">
        <DialogHeader>
          <DialogTitle>Select Payment Method</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Total Amount Display */}
          <div className="bg-primary/5 rounded-lg p-4 border border-primary/20">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total Amount:</span>
              <span className="text-2xl font-bold text-primary" data-testid="text-payment-total">
                {formatMoney(totalAmount)}
              </span>
            </div>
          </div>

          {/* Payment Method Selection */}
          <div>
            <Label className="text-base font-medium mb-3 block">
              Choose Payment Method
            </Label>
            <RadioGroup
              value={selectedPaymentMethod}
              onValueChange={(value) => setSelectedPaymentMethod(value as PaymentMethod)}
              className="space-y-3"
            >
              {/* PayPal */}
              <div className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-accent/50 cursor-pointer transition-colors">
                <RadioGroupItem value="paypal" id="paypal" data-testid="radio-paypal" />
                <Label htmlFor="paypal" className="flex-1 cursor-pointer flex items-center">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-[#0070ba] rounded-lg flex items-center justify-center">
                      <i className="fab fa-paypal text-white text-2xl" />
                    </div>
                    <div>
                      <div className="font-semibold">PayPal</div>
                      <div className="text-xs text-muted-foreground">Pay with PayPal account</div>
                    </div>
                  </div>
                </Label>
              </div>

              {/* Apple Pay */}
              <div className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-accent/50 cursor-pointer transition-colors">
                <RadioGroupItem value="applepay" id="applepay" data-testid="radio-applepay" />
                <Label htmlFor="applepay" className="flex-1 cursor-pointer flex items-center">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-black rounded-lg flex items-center justify-center">
                      <i className="fab fa-apple text-white text-2xl" />
                    </div>
                    <div>
                      <div className="font-semibold">Apple Pay</div>
                      <div className="text-xs text-muted-foreground">Pay with Apple Pay</div>
                    </div>
                  </div>
                </Label>
              </div>

              {/* benefitPay */}
              <div className="flex items-center space-x-3 border rounded-lg p-4 hover:bg-accent/50 cursor-pointer transition-colors">
                <RadioGroupItem value="benefitpay" id="benefitpay" data-testid="radio-benefitpay" />
                <Label htmlFor="benefitpay" className="flex-1 cursor-pointer flex items-center">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                      <i className="fas fa-credit-card text-white text-2xl" />
                    </div>
                    <div>
                      <div className="font-semibold">benefitPay</div>
                      <div className="text-xs text-muted-foreground">Local payment option</div>
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Security Notice */}
          <div className="flex items-start space-x-2 text-sm text-muted-foreground bg-secondary rounded-lg p-3">
            <i className="fas fa-lock text-green-600 mt-0.5" />
            <p>
              Your payment information is secure and encrypted. We never store your payment details.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1"
              disabled={isProcessing}
              data-testid="button-cancel-payment"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePayment}
              disabled={isProcessing}
              className="flex-1 btn-primary"
              data-testid="button-confirm-payment"
            >
              {isProcessing ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <i className="fas fa-check-circle mr-2" />
                  Confirm Payment
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
